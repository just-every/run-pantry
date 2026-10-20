// Pantry's HTTP surface. People use /api/pantry/* with their native session;
// agents use /api/pantry/agent/* with a bearer token the owner issued. Every
// route resolves its actor and checks the capability before any work.
import { Hono, type Context as HonoContext } from 'hono'
import type { Bindings } from '../auth.server'
import { deploymentHealth } from '../base/deployment-health'
import { agent, must, person, who, type Actor } from './access'
import { cents, date, Fault, requireThat, type Data } from './core'
import { all, one } from './db'
import type { Command, Context } from './context'
import { settingsCommands, settingsView } from './settings'
import { accountCommands } from './accounts'
import { contactCommands } from './contacts'
import { journalCommands, journalView } from './journal'
import { invoiceDocumentCommands, invoiceDocumentsView, registerInvoiceDocumentRoutes } from './invoice-documents'
import { invoiceCommands, invoicesView } from './invoices'
import { billLifecycleCommands, capturedBillInbox } from './bill-lifecycle'
import { recurringBillCommands, recurringBillsView } from './recurring-bills'
import { payableCommands, billsView, paymentsView } from './payables'
import { bankCommands, bankView } from './bank'
import { matchCommands } from './matching'
import { reconcileCommands, reconciliationState } from './reconcile'
import { yearEndCommands, yearEndState, adjustingEntries } from './year-end'
import { reportPdf } from './report-pdf'
import { closeCommands, closeState } from './close'
import { proposalCommands, proposalsView, agentContext, fileProposal, proposal } from './proposals'
import { moveInCommands, moveInView } from './cutover/commands'
import { xeroRoutes } from './cutover/xero-attachments'
import { ageing, balanceSheet, generalLedger, profitAndLoss, trialBalance } from './reports'
import { basisOf, reportBasis, BASIS_LABEL } from './basis'
import { figureDetail } from './drilldown'
import { cashFlow, cashFlowCommands, cashFlowCsv, cashFlowDetail } from './cash-flow'
import { contactTotals } from './contact-totals'
import { statementColumns } from './statement-columns'
import { reportExport } from './report-export'
import { isLibrary, libraryReport } from './report-library'
import { libraryExport } from './report-library/export'
import { recordView } from './records'
import { salesTax } from './sales-tax'
import { contractorCommands, contractors, necCsv } from './contractors'
import { accountantPackage, ledgerCsv } from './package'
import { packageZip } from './package-files'
import { dashboard } from './dashboard'
import { activity, actorView, documents, lookups, overview } from './views'
import { ruleCommands, rulesView } from './rules'
import { bankLinesView } from './bank-lines'
import { feedCommands, feedsView } from './feeds/commands'
import { anyDue, runDue, syncItem } from './feeds/sync'
import { receive, verify } from './feeds/webhook'
import { availability } from './feeds/plaid'
import { documentFile } from './documents'
import { receiptCommands, receiptRoutes } from './receipts/routes'
import { deliveryCommands, deliveriesView, reminderPlans, sendingView } from './delivery'
import { recurringCommands, recurringView } from './recurring'
import { stripeCommands, stripeView } from './stripe'
import { clearingState } from './stripe-clearing'
import { payoutCommands, payoutsView } from './payouts'
import { gustoCommands, gustoRoutes, gustoView } from './gusto/commands'
import { depositNotes, depositProposals } from './automatch'
import { depositCommands } from './deposit-confirm'
import { recordedPaymentCandidates } from './recorded-payments'
import { vendorCreditCommands, vendorCreditsView } from './vendor-credits'
import { customer } from './customer-page'
import { runDueWork } from './due'
import { parse as parseQuestion, withThreads as questionThreads } from './questions/store'
import { questionCommands, questionsView } from './questions/commands'
import { integrationCommands, integrationSettings } from './integrations/credentials'
import { integrations } from './integrations/routes'
import { recognitionCommands, recognitionView } from './recognition'
import { recurringJournalCommands, recurringJournalsView } from './recurring-journals'
import { transferCommands } from './transfers'
import { vendorHistory } from './vendor-history'
import { customerHistory } from './customer-history'
import { billApprovalCommands } from './bill-approval'
import { exemptionCommands, exemptionView } from './exemptions'
import { nexusCommands, nexusWatch } from './nexus'
import { reviewCommands, reviewView } from './review'
import { smallBalances, writeOffCommands } from './write-offs'
import { budgetCommands, budget, budgetsView } from './budgets/commands'
import { budgetReport, budgetCsv } from './budgets/report'
import { checkCommands, checksView } from './checks/commands'
import { checksRoutes } from './checks/routes'
import { itemCommands } from './items/commands'
import { salesByItem } from './items/report'
import { customReportCommands } from './custom-reports/commands'
import { registerCustomReportRoutes } from './custom-reports/routes'

const commands: Record<string, Command> = {
  ...invoiceDocumentCommands, ...billLifecycleCommands, ...recurringBillCommands, ...customReportCommands, ...itemCommands, ...checkCommands, ...budgetCommands, ...recognitionCommands, ...recurringJournalCommands, ...transferCommands, ...billApprovalCommands, ...exemptionCommands, ...nexusCommands, ...reviewCommands, ...writeOffCommands, ...settingsCommands, ...accountCommands, ...cashFlowCommands, ...contactCommands, ...journalCommands, ...invoiceCommands, ...payableCommands, ...vendorCreditCommands,
  ...yearEndCommands, ...bankCommands, ...matchCommands, ...depositCommands, ...reconcileCommands, ...closeCommands, ...proposalCommands, ...moveInCommands, ...contractorCommands,
  ...ruleCommands, ...feedCommands,
  ...receiptCommands, ...deliveryCommands, ...recurringCommands, ...stripeCommands, ...questionCommands, ...payoutCommands, ...gustoCommands, ...integrationCommands,
}

type C = HonoContext<{ Bindings: Bindings }>
export const api = new Hono<{ Bindings: Bindings }>()

// Ordinary requests also run due work (reminders, recurring invoices, Stripe follow-up) after they answer.
api.use('*', async (c, next) => {
  await next()
  c.executionCtx.waitUntil(runDueWork(c.env).catch(error => console.error('Pantry due work failed:', error)))
})
api.get('/health', c => c.json({ status: 'ok', ...deploymentHealth(c.env) }))
api.route('/', customer)
api.use('/api/pantry/*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('x-content-type-options', 'nosniff') })
// Feed syncs that have come due run after an ordinary read answers, as well as on the Cron trigger.
api.use('/api/pantry/*', async (c, next) => { await next(); if (c.req.method === 'GET' && await anyDue(c.env)) c.executionCtx.waitUntil(runDue(c.env, 2).catch(e => console.error(e))) })
api.onError((e, c) => e instanceof Fault ? c.json({ error: e.message }, e.status as 400) : (console.error(e), c.json({ error: 'Unexpected error; check the server log' }, 500)))

async function reader(c: C): Promise<Context> {
  const actor = await person(c.req.raw, c.env)
  must(actor, 'read')
  return { db: c.env.DB, env: c.env, request: c.req.raw, actor }
}

const view = (path: string, build: (ctx: Context, c: C) => Promise<unknown>) => api.get(`/api/pantry/${path}`, async c => c.json(await build(await reader(c), c)))
api.route('/api/pantry/integration/v1', integrations)
view('integrations', async (ctx, c) => { must(ctx.actor, 'owner'); return integrationSettings(ctx, c.req.query('cursor')) })
const day = (c: C, name: string, fallback = new Date().toISOString().slice(0, 10)) => date(c.req.query(name) ?? fallback, name)

registerInvoiceDocumentRoutes(api, reader)
view('invoice-documents', async ctx => invoiceDocumentsView(ctx.db))
registerCustomReportRoutes(api, reader)
view('vendors/:id/history', async (ctx, c) => vendorHistory(ctx.db, c.req.param('id')!))
view('customers/:id', async (ctx, c) => customerHistory(ctx.db, c.req.param('id')!, c.req.query('to')))
view('customers/:id/history', async (ctx, c) => customerHistory(ctx.db, c.req.param('id')!, c.req.query('to')))
view('dashboard', async (ctx, c) => dashboard(ctx.db, day(c, 'to'), c.req.query('basis') ? basisOf(c.req.query('basis')) : undefined))
view('state', async ctx => ({ actor: actorView(ctx.actor as any), ...(await lookups(ctx.db)), overview: await overview(ctx.db), settings: await settingsView(ctx) }))
view('recurring-journals', async ctx => recurringJournalsView(ctx.db))
view('journal', async ctx => ({ entries: await journalView(ctx.db) }))
view('review', async ctx => reviewView(ctx.db, ctx.actor.email))
view('write-offs/candidates', async (ctx, c) => ({ items: await smallBalances(ctx.db, c.req.query('kind') === 'bill' ? 'bill' : 'invoice', cents(c.req.query('ceiling'), 'Write off balances up to')) }))
view('sales', async ctx => ({ capturedBills: await capturedBillInbox(ctx.db), recurringBills: await recurringBillsView(ctx.db), approvalRules: await all(ctx.db, 'SELECT * FROM pt_capture_approval_rules ORDER BY minimum_cents'), vendorCredits: await vendorCreditsView(ctx.db), invoices: await invoicesView(ctx.db), bills: await billsView(ctx.db), payments: await paymentsView(ctx.db), deliveries: await deliveriesView(ctx.db), reminders: await reminderPlans(ctx.db), recurring: await recurringView(ctx.db), onlinePayments: await all(ctx.db, 'SELECT id, invoice_id, method, amount_cents, status, fee_cents, created_at, updated_at FROM pt_stripe_payments ORDER BY created_at DESC LIMIT 500') }))
view('invoicing', async ctx => ({ sending: await sendingView(ctx.env, ctx.db), stripe: await stripeView(ctx.env, ctx.db) }))
view('stripe/clearing', async ctx => clearingState(ctx.db))
view('connected', async ctx => ({ clearing: await clearingState(ctx.db), payouts: await payoutsView(ctx.env, ctx.db), gusto: await gustoView(ctx) }))
view('bank', async ctx => bankView(ctx.db))
view('bank/lines', async ctx => bankLinesView(ctx.db))
view('bank/rules', async ctx => rulesView(ctx.db))
view('bank/feeds', async ctx => feedsView(ctx))
view('reconciliation/:statement', async (ctx, c) => { const r = await reconciliationState(ctx.db, c.req.param('statement')!); return { ...r, depositNotes: await depositNotes(ctx.db, r.lines), depositProposals: await depositProposals(ctx.db, r.lines), recordedPayments: await recordedPaymentCandidates(ctx.db, r.lines) } })
view('year-end/:year', async (ctx, c) => yearEndState(ctx.db, Number(c.req.param('year'))))
api.get('/api/pantry/year-end/:year/adjusting-entries.pdf', async c => {
  const ctx = await reader(c), basis = await reportBasis(ctx.db, c.req.query('basis')), r = await adjustingEntries(ctx.db, Number(c.req.param('year'))), entity = await one(ctx.db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
  return new Response(reportPdf({ business: entity!.legal_name, title: 'Adjusting entries', basis: BASIS_LABEL[basis], range: `${r.start} to ${r.end}`,
    rows: r.entries.flatMap(e => e.lines.flatMap((l: Data) => [
      ...(l.debit_cents ? [{ description: `Entry ${e.number} · ${e.memo} · ${l.code} ${l.name} · debit`, amount: l.debit_cents }] : []),
      ...(l.credit_cents ? [{ description: `Entry ${e.number} · ${e.memo} · ${l.code} ${l.name} · credit`, amount: l.credit_cents }] : [])])),
    totals: [{ description: 'Total debits', amount: r.debit }, { description: 'Total credits', amount: r.credit }] }),
    { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="adjusting-entries-${r.year}.pdf"`, 'cache-control': 'no-store' } })
})
view('close/:period', async (ctx, c) => closeState(ctx.db, c.req.param('period')!))
view('proposals', async ctx => ({ proposals: await proposalsView(ctx.db) }))
view('questions/record', async (ctx, c) => ({ questions: await questionThreads(ctx.db, (await all(ctx.db, 'SELECT * FROM pt_questions WHERE subject_kind = ? AND subject_id = ? ORDER BY asked_at', c.req.query('kind') ?? '', c.req.query('id') ?? '')).map(parseQuestion)) }))
view('questions', async (ctx, c) => questionsView(ctx, c.req.query('q') || undefined))
view('move-in', async ctx => moveInView(ctx))
view('activity', async (ctx, c) => activity(ctx.db, c.req.query()))
view('exemptions', async ctx => exemptionView(ctx.db))
view('sales-tax/nexus', async ctx => nexusWatch(ctx.db))
view('documents', async ctx => ({ documents: await documents(ctx.db) }))
const year = (c: C) => { const y = Number(c.req.query('year') ?? new Date().getUTCFullYear()); requireThat(Number.isInteger(y) && y >= 2000 && y <= 2100, 'Choose a tax year'); return y }
checksRoutes(api)
view('checks', async ctx => checksView(ctx.db))
view('budgets', async ctx => budgetsView(ctx.db))
view('budgets/:id', async (ctx, c) => budget(ctx.db, c.req.param('id')!))
view('budgets/:id/report', async (ctx, c) => budgetReport(ctx.db, c.req.param('id')!, day(c, 'from'), day(c, 'to'), await reportBasis(ctx.db, c.req.query('basis'))))
api.get('/api/pantry/budgets/:id/report.csv', async c => {
  const ctx = await reader(c), r = await budgetReport(ctx.db, c.req.param('id')!, day(c, 'from'), day(c, 'to'), await reportBasis(ctx.db, c.req.query('basis')))
  return new Response(budgetCsv(r), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="budget-actual.csv"', 'cache-control': 'no-store' } })
})
view('recognition', async (ctx, c) => recognitionView(ctx.db, day(c, 'to')))
view('reports/detail', async (ctx, c) => {
  const to = day(c, 'to'), from = day(c, 'from', to.slice(0, 8) + '01')
  const e = await one(ctx.db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
  return figureDetail(ctx.db, { report: c.req.query('report') ?? '', line: c.req.query('line') ?? '', from, to, basis: await reportBasis(ctx.db, c.req.query('basis')) }, Number(e?.fiscal_year_start ?? 1))
})
view('reports/record/:kind/:id', async (ctx, c) => recordView(ctx.db, c.req.param('kind')!, c.req.param('id')!))
view('reports/adjusting-entries', async (ctx, c) => ({ ...await adjustingEntries(ctx.db, year(c)), basis: await reportBasis(ctx.db, c.req.query('basis')) }))
view('reports/contractors', async (ctx, c) => contractors(ctx.db, year(c)))
view('reports/cash-flow/detail', async (ctx, c) => cashFlowDetail(ctx.db, day(c, 'from'), day(c, 'to'), c.req.query('line') ?? ''))
api.get('/api/pantry/reports/cash-flow.csv', async c => {
  const ctx = await reader(c), from = day(c, 'from'), to = day(c, 'to')
  return new Response(cashFlowCsv(await cashFlow(ctx.db, from, to)), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="pantry-cash-flow-${from}-${to}.csv"`, 'cache-control': 'no-store' } })
})
api.get('/api/pantry/reports/:kind/export', async c => {
  const ctx = await reader(c), to = day(c, 'to'), from = day(c, 'from', to.slice(0, 8) + '01')
  if (isLibrary(c.req.param('kind')!)) return libraryExport(ctx.db, await libraryReport(ctx.db, c.req.param('kind')!, from, to, await reportBasis(ctx.db, c.req.query('basis')), c.req.query('account'), c.req.query('payee')), c.req.query('format') ?? 'pdf')
  return reportExport(ctx.db, c.req.param('kind')!, from, to, await reportBasis(ctx.db, c.req.query('basis')), c.req.query('format') ?? 'pdf', c.req.query('columns'))
})
view('reports/:kind', async (ctx, c) => {
  const kind = c.req.param('kind')!, to = day(c, 'to'), from = day(c, 'from', to.slice(0, 8) + '01'), basis = await reportBasis(ctx.db, c.req.query('basis'))
  if (isLibrary(kind)) return libraryReport(ctx.db, kind, from, to, basis, c.req.query('account'), c.req.query('payee'))
  const e = await one(ctx.db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
  if (kind === 'sales-by-customer' || kind === 'expenses-by-vendor') return contactTotals(ctx.db, kind === 'sales-by-customer' ? 'customer' : 'vendor', from, to, basis)
  if (kind === 'sales-by-item') return salesByItem(ctx.db, from, to, basis)
  if (kind === 'cash-flow') return cashFlow(ctx.db, from, to)
  if (kind === 'trial-balance') return trialBalance(ctx.db, to, basis)
  if (kind === 'general-ledger') return generalLedger(ctx.db, from, to, c.req.query('account') || undefined, basis)
  if ((kind === 'profit-and-loss' || kind === 'balance-sheet') && c.req.query('columns') && c.req.query('columns') !== 'single') return statementColumns(ctx.db, kind, c.req.query('columns')!, from, to, Number(e?.fiscal_year_start ?? 1), basis)
  if (kind === 'profit-and-loss') return profitAndLoss(ctx.db, from, to, basis)
  if (kind === 'balance-sheet') return balanceSheet(ctx.db, to, Number(e?.fiscal_year_start ?? 1), basis)
  if (kind === 'sales-tax') return salesTax(ctx.db, from, to, basis)
  if (kind === 'receivables' || kind === 'payables') return ageing(ctx.db, kind === 'receivables' ? 'receivable' : 'payable', to)
  throw new Fault(404, 'Unknown report')
})

// The 1099-NEC filing file carries full TINs: the owner or someone with the posting grant, audited.
api.get('/api/pantry/reports/contractors/:year/1099-nec.csv', async c => {
  const ctx = await reader(c)
  must(ctx.actor, 'post')
  const y = Number(c.req.param('year'))
  requireThat(Number.isInteger(y) && y >= 2000 && y <= 2100, 'Choose a tax year')
  return new Response(await necCsv(ctx.db, who(ctx.actor), y), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="pantry-1099-nec-${y}.csv"`, 'cache-control': 'no-store' } })
})

api.get('/api/pantry/documents/:id', async c => {
  const ctx = await reader(c)
  const doc = await documentFile(ctx.db, c.req.param('id'))
  requireThat(doc, 'Document not found', 404)
  // ?view=1 shows a photo in the page; everything else downloads.
  const inline = c.req.query('view') === '1' && /^image\/(png|jpeg|webp|gif)$/.test(doc.mediaType)
  return new Response(doc.bytes, { headers: { 'content-type': doc.mediaType, 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${doc.name.replace(/[^\w.-]+/g, '_')}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } })
})

receiptRoutes(api)
xeroRoutes(api)
gustoRoutes(api)

// Exports name their basis: in the file name (cash only, so accrual names stay as they were) and inside the file.
const suffix = (basis: string) => basis === 'cash' ? '-cash' : ''

api.get('/api/pantry/package/:period', async c => {
  const ctx = await reader(c), period = c.req.param('period'), basis = await reportBasis(ctx.db, c.req.query('basis'))
  const body = JSON.stringify(await accountantPackage(ctx.db, period, basis), null, 2)
  return new Response(body, { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="pantry-close-${period}${suffix(basis)}.json"`, 'cache-control': 'no-store' } })
})

// The same package as an accountant opens it: a ZIP of CSV reports, the checklist, a README and the JSON.
api.get('/api/pantry/package/:period/accountant-package.zip', async c => {
  const ctx = await reader(c), period = c.req.param('period'), basis = await reportBasis(ctx.db, c.req.query('basis'))
  const { bytes } = await packageZip(ctx.db, period, basis)
  return new Response(bytes, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="pantry-close-${period}${suffix(basis)}.zip"`, 'x-pantry-basis': BASIS_LABEL[basis], 'cache-control': 'no-store' } })
})

api.get('/api/pantry/package/:period/general-ledger.csv', async c => {
  const ctx = await reader(c), period = c.req.param('period'), basis = await reportBasis(ctx.db, c.req.query('basis'))
  return new Response(await ledgerCsv(ctx.db, period, basis), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="pantry-general-ledger-${period}${suffix(basis)}.csv"`, 'x-pantry-basis': BASIS_LABEL[basis], 'cache-control': 'no-store' } })
})

api.post('/api/pantry/command/:op', async c => {
  const command = commands[c.req.param('op')]
  requireThat(command, 'Unknown action', 404)
  const actor: Actor = await person(c.req.raw, c.env)
  must(actor, command.need)
  requireThat(Number(c.req.header('content-length') ?? 0) <= 8_000_000, 'Request too large', 413)
  const body = await c.req.json().catch(() => { throw new Fault(400, 'Send a JSON object') })
  requireThat(body && typeof body === 'object' && !Array.isArray(body), 'Send a JSON object')
  return c.json(await command.run({ db: c.env.DB, env: c.env, request: c.req.raw, actor }, body as Data))
})

// Plaid's webhook: verified by its signature, never by a session. It marks work due; the sync runs after the answer.
api.post('/api/pantry/feeds/plaid/webhook', async c => {
  const a = availability(c.env)
  requireThat(a.available, a.available ? '' : a.reason, 503)
  const body = await c.req.text()
  requireThat(body.length <= 100_000, 'Request too large', 413)
  await verify(c.env, c.req.header('plaid-verification') ?? null, body)
  const item = await receive(c.env, (() => { try { return JSON.parse(body) } catch { throw new Fault(400, 'Send a JSON object') } })())
  if (item) c.executionCtx.waitUntil(syncItem(c.env, item, 'webhook').catch(e => console.error(e)))
  return c.json({ ok: true })
})

// Agents: read context, file proposals, follow their outcome. Nothing else.
api.get('/api/pantry/agent/context', async c => {
  const actor = await agent(c.req.raw, c.env)
  return c.json(await agentContext({ db: c.env.DB, env: c.env, request: c.req.raw, actor }, c.req.query('period') || undefined))
})
api.post('/api/pantry/agent/proposals', async c => {
  const actor = await agent(c.req.raw, c.env)
  const body = await c.req.json().catch(() => { throw new Fault(400, 'Send a JSON object') })
  return c.json(await fileProposal(c.env.DB, actor, body as Data))
})
api.get('/api/pantry/agent/proposals/:id', async c => {
  const actor = await agent(c.req.raw, c.env)
  const p = await proposal(c.env.DB, c.req.param('id'))
  requireThat(p.agent_id === actor.id, 'Proposal not found', 404)
  return c.json(p)
})
