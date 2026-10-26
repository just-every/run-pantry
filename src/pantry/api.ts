import { autopayCommands, registerAutopayRoutes } from './autopay'
import { textingCommands, registerTextingRoutes, textingView } from './texting'
import { paymentNoticeCommands,paymentNoticesView } from './payment-notices'
import { compareStripeEvents,stripeEventsView } from './stripe-events'
import { invoiceVoidCommands } from './invoice-void'
import { refundCommands } from './refunds/commands'
import { refundsView } from './refunds/store'
import { customerCreditCommands } from './customer-credits'
import { lateDiscountCommands } from './late-discount'
import { approvedWriteOffCommands } from './approved-write-offs'
import { lateFeeCommands, lateFeesView } from './late-fees'
import { taxReminderCommands, taxRemindersView } from './tax-reminders'
import { taxReadinessCommands, taxReadiness, taxYearPackage } from './tax-readiness'
import { w9Commands, w9Public, w9Status, missingW9 } from './w9'
import { askBooks } from './ask'
import { currencyCommands,currencyView } from './currency'
import { archiveCommands,archivesView } from './cutover/archives'
import { collectionCommands,collectionsView } from './collections'
import { standingCommands,standingView } from './standing'
import { learningCommands,learningView } from './learning'
import { assetCommands,assetView } from './assets'
import { cashPlanner } from './cash-planner'
import { search } from './search'
import { upgradeTins } from './contractor-tin'
import { contractorFormExport } from './contractor-export'
import { reportDeliveryCommands, deliverySettings, deliveryAttachment } from './report-delivery'
import { nativeReportExport } from './report-export-reader'
import { accountantExport } from './accountant-export'
import { adjustingReport } from './dimensions/special-reports'
import { budgetSplits } from './dimensions/budget-splits'
import { reportSplits, splitLibrary } from './dimensions/splits'
import { fiscalYearStart } from './reports'
import { dimensionScope } from './dimensions/scope'
import { projectProfit } from './dimensions/report'
import { dimensionCommands, dimensionsView, dimensionHistory } from './dimensions'
import { closeBoard } from './close-workflow'
import { figureExport, recordExport } from './detail-export'
// Pantry's HTTP surface. People use /api/pantry/* with their native session;
// agents use /api/pantry/agent/* with a bearer token the owner issued. Every
// route resolves its actor and checks the capability before any work.
import { Hono, type Context as HonoContext } from 'hono'
import type { Bindings } from '../auth.server'
import { deploymentHealth } from '../base/deployment-health'
import { authority, agent, must, person, who, type Actor } from './access'
import { cents, date, Fault, monthBounds, requireThat, type Data } from './core'
import { all, one, run } from './db'
import type { Command, Context } from './context'
import { settingsCommands, settingsView } from './settings'
import { accountCommands } from './accounts'
import { contactCommands } from './contacts'
import { journalCommands, journalView } from './journal'
import { invoiceDocumentCommands, invoiceDocumentsView, registerInvoiceDocumentRoutes } from './invoice-documents'
import { invoiceCommands, invoicesView } from './invoices'
import { issuingLimitCommands, selfApprovedDocuments } from './issuing-limits'
import { discountAccounts, discountCommands, discountSettings } from './discounts'
import { earlyPaymentCommands, treatmentsView } from './early-payment'
import { billLifecycleCommands, capturedBillInbox } from './bill-lifecycle'
import { recurringBillCommands, recurringBillsView } from './recurring-bills'
import { payableCommands, billsView, paymentsView } from './payables'
import { bankCommands, bankView } from './bank'
import { queueCommands } from './bank-queue'
import { matchCommands } from './matching'
import { reconcileCommands, reconciliationState } from './reconcile'
import { yearEndCommands, yearEndState, adjustingEntries } from './year-end'
import { reportPdf } from './report-pdf'
import { closeCommands, closeState } from './close'
import { continuousCheckCommands, continuousChecksView } from './continuous/run'
import { proposalCommands, proposalsView, agentContext, fileProposal, proposal } from './proposals'
import { moveInCommands, moveInView } from './cutover/commands'
import { xeroRoutes } from './cutover/xero-attachments'
import { basisOf, reportBasis, BASIS_LABEL } from './basis'
import { reportFigure, type FigureQuery } from './report-figures'
import { cashFlow, cashFlowCommands, cashFlowCsv, cashFlowDetail } from './cash-flow'
import { reportExport } from './report-export'
import { isLibrary, libraryReport } from './report-library'
import { libraryExport } from './report-library/export'
import { recordView } from './records'
import { contractorCommands, contractors } from './contractors'
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
import { readReport } from './report-reader'
import { customReportCommands } from './custom-reports/commands'
import { registerCustomReportRoutes } from './custom-reports/routes'
import { erasureCommands, erasureSettings } from './erasure/commands'
import { ownerSession } from './erasure/owner'
import { webhookCommands, webhookSettings } from './webhooks/commands'
import { runWebhooks } from './webhooks/deliver'
import { dataFlows } from './data-flows'
import { recordReportIssue } from './effects/issues'
import { FIRST_DAY } from './report-sources'
import { siblingCommands, siblingsView, siblingArtifact } from './estimates/siblings'
import { assertDoor, projectAccess, financialSourceAllowed, limitedBanks } from './access-policy/doors'
import { accessPolicyCommands } from './access-policy/settings'
import { timeCommands, timeView } from './time/commands'
import { estimateCommands, estimatesView, estimate, registerEstimateRoutes } from './estimates'
import { customerDepositCommands, customerDepositsView } from './customer-deposits'
import { statementCommands } from './statements/commands'
import { statement } from './statements/store'

const commands: Record<string, Command> = {
  ...autopayCommands, ...textingCommands, ...statementCommands,
  ...taxReminderCommands,...taxReadinessCommands,...w9Commands, ...currencyCommands,...archiveCommands,...collectionCommands, ...standingCommands, ...learningCommands, ...assetCommands, ...dimensionCommands, ...siblingCommands,
  'stripe.events-compare': { need:'owner', async run(c) { await run(c.db,[authority(c.actor,'owner')]); return compareStripeEvents(c.env,c.db,true) } }, ...paymentNoticeCommands, ...invoiceVoidCommands, ...refundCommands, ...customerCreditCommands, ...lateDiscountCommands, ...approvedWriteOffCommands, ...lateFeeCommands, ...estimateCommands, ...customerDepositCommands, ...accessPolicyCommands, ...timeCommands, ...webhookCommands, ...erasureCommands, ...issuingLimitCommands, ...invoiceDocumentCommands, ...discountCommands, ...earlyPaymentCommands, ...billLifecycleCommands, ...recurringBillCommands, ...customReportCommands, ...itemCommands, ...checkCommands, ...budgetCommands, ...recognitionCommands, ...recurringJournalCommands, ...transferCommands, ...billApprovalCommands, ...exemptionCommands, ...nexusCommands, ...reviewCommands, ...writeOffCommands, ...settingsCommands, ...accountCommands, ...cashFlowCommands, ...contactCommands, ...journalCommands, ...invoiceCommands, ...payableCommands, ...vendorCreditCommands,
  ...continuousCheckCommands, ...yearEndCommands, ...bankCommands, ...matchCommands, ...queueCommands, ...depositCommands, ...reconcileCommands, ...closeCommands, ...proposalCommands, ...moveInCommands, ...contractorCommands,
  ...reportDeliveryCommands, ...ruleCommands, ...feedCommands,
  ...receiptCommands, ...deliveryCommands, ...recurringCommands, ...stripeCommands, ...questionCommands, ...payoutCommands, ...gustoCommands, ...integrationCommands,
}

type C = HonoContext<{ Bindings: Bindings }>
export const api = new Hono<{ Bindings: Bindings }>()

// Ordinary requests also run due work (reminders, recurring invoices, Stripe follow-up) after they answer.
api.use('*', async (c, next) => {
  await upgradeTins(c.env)
  await next()
  if(c.req.method!=='GET')c.executionCtx.waitUntil(runWebhooks(c.env).catch(()=>console.error('Webhook dispatch failed')))
  c.executionCtx.waitUntil(runDueWork(c.env).catch(error => console.error('Pantry due work failed:', error)))
})
api.get('/health', c => c.json({ status: 'ok', ...deploymentHealth(c.env) }))
registerTextingRoutes(api)
api.route('/', customer)
api.route('/', w9Public)
api.use('/api/pantry/*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('x-content-type-options', 'nosniff') })
// Feed syncs that have come due run after an ordinary read answers, as well as on the Cron trigger.
api.use('/api/pantry/*', async (c, next) => { await next(); if (c.req.method === 'GET' && await anyDue(c.env)) c.executionCtx.waitUntil(runDue(c.env, 2).catch(e => console.error(e))) })
api.use('/api/pantry/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (!/^\/api\/pantry\/(?:command\/|agent\/|integration\/v1(?:\/|$)|feeds\/plaid\/webhook$|stripe\/webhook$)/.test(path)) {
    const actor = await person(c.req.raw, c.env)
    await assertDoor({ db: c.env.DB, env: c.env, request: c.req.raw, actor }, path)
  }
  await next()
})
api.onError((e, c) => e instanceof Fault ? c.json({ error: e.message }, e.status as 400) : (console.error(e), c.json({ error: 'Unexpected error; check the server log' }, 500)))

async function reader(c: C): Promise<Context> {
  const actor = await person(c.req.raw, c.env)
  must(actor, 'read')
  const ctx = { db: c.env.DB, env: c.env, request: c.req.raw, actor }
  await assertDoor(ctx, c.req.url)
  return ctx
}

const view = (path: string, build: (ctx: Context, c: C) => Promise<unknown>) => api.get(`/api/pantry/${path}`, async c => { const ctx = await reader(c); return c.json(await projectAccess(ctx, await build(ctx, c))) })
view('tax-reminders',async(ctx,c)=>taxRemindersView(ctx,year(c)))
view('tax-readiness',async(ctx,c)=>taxReadiness(ctx,year(c)))
view('tax-readiness/:year/package',async(ctx,c)=>taxYearPackage(ctx,Number(c.req.param('year'))))
view('vendor-w9/:id',async(ctx,c)=>w9Status(ctx.db,c.req.param('id')!))
view('missing-w9',async(ctx,c)=>({vendors:await missingW9(ctx.db,year(c))}))
view('currency',async ctx=>currencyView(ctx))
view('document-archives',async ctx=>archivesView(ctx))
view('collections',async ctx=>collectionsView(ctx))
view('agent-permissions',async ctx=>standingView(ctx))
view('learned-recognition',async ctx=>learningView(ctx.db))
view('assets', async ctx=>assetView(ctx.db))
view('cash-planner', async (ctx,c) => cashPlanner(ctx,new URL(c.req.url).searchParams))
view('search', async (ctx,c) => search(ctx.db,ctx.actor,new URL(c.req.url).searchParams))
view('time', async ctx => timeView(ctx))
view('report-delivery', async ctx => deliverySettings(ctx))
api.get('/api/pantry/report-delivery/:id/attachment', async c => { const file=await deliveryAttachment(await reader(c),c.req.param('id')); return new Response(file.bytes as Uint8Array<ArrayBuffer>,{headers:{'content-type':file.contentType,'content-disposition':`attachment; filename="${file.filename}"`,'cache-control':'no-store'}}) })
api.route('/api/pantry/integration/v1', integrations)
view('webhooks', async ctx => webhookSettings(ctx))
view('data-flows', async ctx => dataFlows(ctx))
view('erasure', async ctx => { await ownerSession(ctx); return erasureSettings(ctx.db) })
view('ask', async (ctx, c) => askBooks(ctx, c.req.query('question'), c.req.query('basis')))
view('integrations', async (ctx, c) => { must(ctx.actor, 'owner'); return integrationSettings(ctx, c.req.query('cursor')) })
const day = (c: C, name: string, fallback = new Date().toISOString().slice(0, 10)) => date(c.req.query(name) ?? fallback, name)

registerAutopayRoutes(api, reader)
view('texting', async ctx => textingView(ctx))
registerEstimateRoutes(api, reader)
view('estimates/:id/siblings', async (ctx, c) => siblingsView(ctx, c.req.param('id')!))
api.get('/api/pantry/estimate-siblings/:id/document', async c => {
  const document = await siblingArtifact(await reader(c), c.req.param('id'))
  return new Response(document.bytes, { headers: { 'content-type': document.mediaType, 'content-disposition': `inline; filename="${document.name}"`, 'content-security-policy': "default-src 'none'; sandbox" } })
})
view('estimates', async ctx => estimatesView(ctx))
view('dimensions',async ctx=>dimensionsView(ctx.db))
view('dimensions/project',async(ctx,c)=>projectProfit(ctx.db,c.req.query('name')??'',day(c,'from'),day(c,'to'),await reportBasis(ctx.db,c.req.query('basis')),await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))))
view('dimensions/project/splits',async(ctx,c)=>{
 const from=day(c,'from'),to=day(c,'to'),basis=await reportBasis(ctx.db,c.req.query('basis'))
 return reportSplits(ctx.db,'project-profitability',c.req.query('split')??'',{from,to,basis},scope=>projectProfit(ctx.db,c.req.query('name')??'',from,to,basis,scope))
})

view('estimates/:id', async (ctx, c) => estimate(ctx.db, c.req.param('id')!))
view('customer-deposits', async ctx => customerDepositsView(ctx))
registerInvoiceDocumentRoutes(api, reader)
view('invoice-documents', async ctx => invoiceDocumentsView(ctx.db))
registerCustomReportRoutes(api, reader)
view('/vendors/:id/history'.slice(1), async (ctx, c) => vendorHistory(ctx.db, c.req.param('id')!, c.req.query('from'), c.req.query('to')))
view('customers/:id', async (ctx, c) => customerHistory(ctx.db, c.req.param('id')!, c.req.query('to'), !limitedBanks(ctx.actor)))
view('customers/:id/history', async (ctx, c) => customerHistory(ctx.db, c.req.param('id')!, c.req.query('to'), !limitedBanks(ctx.actor)))
view('late-fees', async ctx => lateFeesView(ctx))
view('statements/:id', async (ctx, c) => statement(ctx, c.req.param('id')!))
api.get('/api/pantry/statements/:id/document', async c => {
  const saved = await statement(await reader(c), c.req.param('id'))
  return new Response(saved.html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin', 'x-robots-tag': 'noindex, nofollow' } })
})
view('dashboard', async (ctx, c) => dashboard(ctx.db, day(c, 'to'), c.req.query('basis') ? basisOf(c.req.query('basis')) : undefined))
view('state', async ctx => ({ actor: actorView(ctx.actor as any), ...(await lookups(ctx.db)), dimensionHistory: financialSourceAllowed(ctx.actor,'profit-and-loss')?await dimensionHistory(ctx.db):[], overview: await overview(ctx.db), settings: await settingsView(ctx) }))
view('close-board', async (ctx, c) => closeBoard(ctx.db, c.req.query('year') ?? new Date().getUTCFullYear().toString()))
view('recurring-journals', async ctx => recurringJournalsView(ctx.db))
view('journal', async ctx => ({ entries: await journalView(ctx.db) }))
view('review', async ctx => reviewView(ctx.db, ctx.actor.email))
view('write-offs/candidates', async (ctx, c) => ({ items: await smallBalances(ctx.db, c.req.query('kind') === 'bill' ? 'bill' : 'invoice', cents(c.req.query('ceiling'), 'Write off balances up to')) }))
view('sales', async ctx => ({ refunds: await refundsView(ctx.db), paymentNotices: await paymentNoticesView(ctx.db), capturedBills: await capturedBillInbox(ctx.db), recurringBills: await recurringBillsView(ctx.db), approvalRules: await all(ctx.db, 'SELECT * FROM pt_capture_approval_rules ORDER BY minimum_cents'), vendorCredits: await vendorCreditsView(ctx.db), invoices: await invoicesView(ctx.db), bills: await billsView(ctx.db), payments: await paymentsView(ctx.db), deliveries: await deliveriesView(ctx.db), reminders: await reminderPlans(ctx.db), recurring: await recurringView(ctx.db), onlinePayments: await all(ctx.db, 'SELECT id, invoice_id, method, amount_cents, status, fee_cents, created_at, updated_at, refunded_cents, disputed_cents, evidence_due_by, return_entry_id, return_code, return_reason FROM pt_stripe_payments ORDER BY created_at DESC LIMIT 500') }))
view('invoicing', async ctx => ({ sending: await sendingView(ctx.env, ctx.db), stripe: await stripeView(ctx.env, ctx.db), discounts: { settings: await discountSettings(ctx.db), accounts: await discountAccounts(ctx.db) }, earlyPayment: await treatmentsView(ctx.db) }))
view('stripe/events', async ctx => { must(ctx.actor,'owner'); return stripeEventsView(ctx.db) })
view('stripe/clearing', async ctx => clearingState(ctx.db))
view('connected', async ctx => ({ clearing: await clearingState(ctx.db), payouts: await payoutsView(ctx.env, ctx.db), gusto: await gustoView(ctx) }))
view('bank', async ctx => bankView(ctx.db))
view('bank/lines', async ctx => bankLinesView(ctx.db))
view('bank/rules', async ctx => rulesView(ctx.db))
view('bank/feeds', async ctx => feedsView(ctx))
view('reconciliation/:statement', async (ctx, c) => { const r = await reconciliationState(ctx.db, c.req.param('statement')!); return { ...r, depositNotes: await depositNotes(ctx.db, r.lines), depositProposals: await depositProposals(ctx.db, r.lines), recordedPayments: await recordedPaymentCandidates(ctx.db, r.lines) } })
view('year-end/:year', async (ctx, c) => yearEndState(ctx.db, Number(c.req.param('year'))))
api.get('/api/pantry/year-end/:year/adjusting-entries.pdf', async c => {
  const ctx = await reader(c), basis = await reportBasis(ctx.db, c.req.query('basis')), r = await adjustingEntries(ctx.db, Number(c.req.param('year')),await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))), entity = await one(ctx.db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:`Adjusting entries · ${r.year}`,from:r.start,to:r.end,basis,report:'general-ledger'})
  return new Response(reportPdf({ business: entity!.legal_name, title: 'Adjusting entries', basis: BASIS_LABEL[basis], range: `${r.start} to ${r.end}`,
    rows: r.entries.flatMap(e => e.lines.flatMap((l: Data) => [
      ...(l.debit_cents ? [{ description: `Entry ${e.number} · ${e.memo} · ${l.code} ${l.name} · debit`, amount: l.debit_cents }] : []),
      ...(l.credit_cents ? [{ description: `Entry ${e.number} · ${e.memo} · ${l.code} ${l.name} · credit`, amount: l.credit_cents }] : [])])),
    totals: [{ description: 'Total debits', amount: r.debit }, { description: 'Total credits', amount: r.credit }] }),
    { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="adjusting-entries-${r.year}.pdf"`, 'cache-control': 'no-store' } })
})
view('continuous-checks', async ctx => continuousChecksView(ctx.db))
view('close/:period', async (ctx, c) => closeState(ctx.db, c.req.param('period')!))
view('proposals', async ctx => ({ proposals: await proposalsView(ctx.db) }))
view('questions/record', async (ctx, c) => ({ questions: await questionThreads(ctx.db, (await all(ctx.db, 'SELECT * FROM pt_questions WHERE subject_kind = ? AND subject_id = ? ORDER BY asked_at', c.req.query('kind') ?? '', c.req.query('id') ?? '')).map(parseQuestion)) }))
view('questions', async (ctx, c) => questionsView(ctx, c.req.query('q') || undefined))
view('move-in', async ctx => moveInView(ctx))
view('self-approved', async (ctx, c) => { must(ctx.actor, 'owner'); return { documents: await selfApprovedDocuments(ctx.db, day(c, 'day'), c.req.query('person') ?? '') } })
view('activity', async (ctx, c) => activity(ctx.db, c.req.query()))
view('exemptions', async ctx => exemptionView(ctx.db))
view('sales-tax/nexus', async ctx => nexusWatch(ctx.db))
view('documents', async ctx => ({ documents: await documents(ctx.db) }))
const year = (c: C) => { const y = Number(c.req.query('year') ?? new Date().getUTCFullYear()); requireThat(Number.isInteger(y) && y >= 2000 && y <= 2100, 'Choose a tax year'); return y }
checksRoutes(api)
view('checks', async ctx => checksView(ctx.db))
view('budgets', async ctx => budgetsView(ctx.db))
view('budgets/:id', async (ctx, c) => budget(ctx.db, c.req.param('id')!))
view('budgets/:id/splits',async(ctx,c)=>budgetSplits(ctx.db,c.req.param('id')!,day(c,'from'),day(c,'to'),await reportBasis(ctx.db,c.req.query('basis')),c.req.query('split')??''))
api.get('/api/pantry/budgets/:id/splits/export',async c=>{
 const ctx=await reader(c),r=await budgetSplits(ctx.db,c.req.param('id')!,day(c,'from'),day(c,'to'),await reportBasis(ctx.db,c.req.query('basis')),c.req.query('split')??'')
 return libraryExport(ctx.db,splitLibrary(r),c.req.query('format')??'csv')
})
view('budgets/:id/report', async (ctx, c) => budgetReport(ctx.db, c.req.param('id')!, day(c, 'from'), day(c, 'to'), await reportBasis(ctx.db, c.req.query('basis')),{dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue')}))
api.get('/api/pantry/budgets/:id/report.csv', async c => {
  const ctx = await reader(c), r = await budgetReport(ctx.db, c.req.param('id')!, day(c, 'from'), day(c, 'to'), await reportBasis(ctx.db, c.req.query('basis')),{dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue')})
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:`Budget report`,from:day(c,'from'),to:day(c,'to'),basis:await reportBasis(ctx.db,c.req.query('basis')),budgetId:c.req.param('id')!,dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue')})
  return new Response(budgetCsv(r), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="budget-actual.csv"', 'cache-control': 'no-store' } })
})
view('recognition', async (ctx, c) => recognitionView(ctx.db, day(c, 'to')))
// A figure's address: its report and line, the range and basis, and the filters, columns, budget or tax year it was read under.
const figureQuery = async (db: D1Database, c: C, from: string, to: string): Promise<FigureQuery> => ({ report: c.req.query('report') ?? '', line: c.req.query('line') ?? '', from, to, basis: await reportBasis(db, c.req.query('basis')),
  account: c.req.query('account'), columns: c.req.query('columns'), column: c.req.query('column'), budget: c.req.query('budget'),projectName:c.req.query('projectName'),dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue'), year: c.req.query('year'), payee: c.req.query('payee') })
api.get('/api/pantry/reports/detail/export', async c => {
  const ctx = await reader(c), to = day(c, 'to'), from = day(c, 'from', to.slice(0, 8) + '01')
  const entity = await one(ctx.db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
  const figure = await figureQuery(ctx.db, c, from, to)
  const detail = await reportFigure(ctx.db, figure, Number(entity?.fiscal_year_start ?? 1))
  const response=figureExport(detail,c.req.query())
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:`${figure.report} · source figure`,from:detail.from ?? FIRST_DAY,to:detail.to,basis:figure.basis,report:figure.report,account:figure.account,payee:figure.payee,columns:figure.columns,budgetId:figure.budget,figure})
  return response
})
api.get('/api/pantry/reports/record/:kind/:id/export', async c => {
  const ctx = await reader(c)
  return recordExport(await recordView(ctx.db, c.req.param('kind')!, c.req.param('id')!), c.req.query())
})
view('reports/detail', async (ctx, c) => {
  const to = day(c, 'to'), from = day(c, 'from', to.slice(0, 8) + '01')
  const e = await one(ctx.db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
  return reportFigure(ctx.db, await figureQuery(ctx.db, c, from, to), Number(e?.fiscal_year_start ?? 1))
})
view('reports/record/:kind/:id', async (ctx, c) => recordView(ctx.db, c.req.param('kind')!, c.req.param('id')!))
view('reports/adjusting-entries',async(ctx,c)=>{const to=day(c,'to',`${year(c)}-12-31`),from=day(c,'from',to.slice(0,4)+'-01-01');return readReport(ctx.db,'adjusting-entries',{from,to,basis:await reportBasis(ctx.db,c.req.query('basis')),columns:c.req.query('columns'),dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue')})})
view('reports/contractors', async (ctx, c) => contractors(ctx.db, year(c),await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))))
view('reports/contractors/splits',async(ctx,c)=>{
 const y=year(c),options={from:`${y}-01-01`,to:`${y}-12-31`,basis:'cash' as const}
 return reportSplits(ctx.db,'contractors',c.req.query('split')??'',options,scope=>contractors(ctx.db,y,scope))
})
api.get('/api/pantry/reports/cash-flow/detail/export', async c => {
  const ctx = await reader(c)
  const detail = await cashFlowDetail(ctx.db, day(c, 'from'), day(c, 'to'), c.req.query('line') ?? '',await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue')))
  const response=figureExport(detail,c.req.query())
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:'Cash flow · source figure',from:day(c,'from'),to:day(c,'to'),basis:'accrual',report:'cash-flow',dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue')})
  return response
})
view('reports/cash-flow/detail', async (ctx, c) => cashFlowDetail(ctx.db, day(c, 'from'), day(c, 'to'), c.req.query('line') ?? '',await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))))
api.get('/api/pantry/reports/cash-flow.csv', async c => {
  const ctx = await reader(c), from = day(c, 'from'), to = day(c, 'to')
  const csv=cashFlowCsv(await cashFlow(ctx.db,from,to,await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))))
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:'Cash flow',from,to,basis:'accrual',report:'cash-flow',dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue')})
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="pantry-cash-flow-${from}-${to}.csv"`, 'cache-control': 'no-store' } })
})
api.get('/api/pantry/reports/:kind/export', async c => {
  const ctx=await reader(c),to=day(c,'to'),from=day(c,'from',to.slice(0,8)+'01')
  const result=await nativeReportExport(ctx.db,c.req.param('kind')!,{...c.req.query(),from,to},c.req.query('format')??'pdf')
  await recordReportIssue(ctx.db,who(ctx.actor),result.issue)
  return result.response
})
view('reports/:kind/splits', async (ctx, c) => {
  const to=day(c,'to'),from=day(c,'from',to.slice(0,8)+'01'),basis=await reportBasis(ctx.db,c.req.query('basis'))
  const options={from,to,basis,account:c.req.query('account'),payee:c.req.query('payee')}
  return reportSplits(ctx.db,c.req.param('kind')!,c.req.query('split')??'',options,scope=>readReport(ctx.db,c.req.param('kind')!,{...options,dimension:scope?.kind,dimensionValue:scope?.id}))
})
view('reports/:kind', async (ctx, c) => {
  const to = day(c, 'to'), from = day(c, 'from', to.slice(0, 8) + '01')
  return readReport(ctx.db, c.req.param('kind')!, { from, to, basis: await reportBasis(ctx.db, c.req.query('basis')), account: c.req.query('account'), payee: c.req.query('payee'), columns: c.req.query('columns'),dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue') })
})

// Masked filing downloads use posting authority; full identity requires step-up.
for (const format of ['csv', 'pdf', 'xlsx']) api.get(`/api/pantry/reports/contractors/:year/1099-nec.${format}`, async c =>
  contractorFormExport(await reader(c), Number(c.req.param('year')), format, c.req.query('fullTin') === 'true'))

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
  const ctx = await reader(c), period = c.req.param('period'), basis = await reportBasis(ctx.db, c.req.query('basis')),dimension=await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))
  const body = JSON.stringify(await accountantPackage(ctx.db, period, basis, dimension), null, 2)
  const range=monthBounds(period)
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'accountant-package',name:`Accountant package · ${period}`,from:range.start,to:range.end,basis,dimension:dimension?.kind,dimensionValue:dimension?.id,...(dimension?{reports:['trial-balance','profit-and-loss','balance-sheet','cash-flow','receivables','payables','general-ledger']}: {})})
  if(dimension){const entity=await one(ctx.db,'SELECT fiscal_year_start FROM pt_entity WHERE id=1');await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:`Package year-to-date profit and loss · ${period}`,report:'profit-and-loss',from:fiscalYearStart(range.end,Number(entity?.fiscal_year_start??1)),to:range.end,basis,dimension:dimension.kind,dimensionValue:dimension.id})}
  return new Response(body, { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="pantry-close-${period}${suffix(basis)}.json"`, 'cache-control': 'no-store' } })
})

api.get('/api/pantry/portability/export', async c => {
  const ctx = await reader(c)
  const { destinationExport } = await import('./portability')
  return destinationExport(ctx, { destination: c.req.query('destination') as 'qbo' | 'xero', year: Number(c.req.query('year')) }, c.req.query('format') as 'zip' | 'json' || 'zip')
})

// The same package as an accountant opens it: a ZIP of CSV reports, the checklist, a README and the JSON.
api.get('/api/pantry/package/:period/export', async c => {
  const ctx=await reader(c),period=c.req.param('period'),basis=await reportBasis(ctx.db,c.req.query('basis')),scope=await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))
  const pkg=await accountantPackage(ctx.db,period,basis,scope),response=accountantExport(pkg,c.req.query('format')??'pdf'),range=monthBounds(period)
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'accountant-package',name:`Accountant package · ${period}`,from:range.start,to:range.end,basis,dimension:scope?.kind,dimensionValue:scope?.id,...(scope?{reports:['trial-balance','profit-and-loss','balance-sheet','cash-flow','receivables','payables','general-ledger']}: {})})
  return response
})
api.get('/api/pantry/package/:period/accountant-package.zip', async c => {
  const ctx = await reader(c), period = c.req.param('period'), basis = await reportBasis(ctx.db, c.req.query('basis')),dimension=await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))
  const { bytes } = await packageZip(ctx.db, period, basis, dimension)
  const range=monthBounds(period)
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'accountant-package',name:`Accountant package · ${period}`,from:range.start,to:range.end,basis,dimension:dimension?.kind,dimensionValue:dimension?.id,...(dimension?{reports:['trial-balance','profit-and-loss','balance-sheet','cash-flow','receivables','payables','general-ledger']}: {})})
  if(dimension){const entity=await one(ctx.db,'SELECT fiscal_year_start FROM pt_entity WHERE id=1');await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:`Package year-to-date profit and loss · ${period}`,report:'profit-and-loss',from:fiscalYearStart(range.end,Number(entity?.fiscal_year_start??1)),to:range.end,basis,dimension:dimension.kind,dimensionValue:dimension.id})}
  return new Response(bytes, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="pantry-close-${period}${suffix(basis)}.zip"`, 'x-pantry-basis': BASIS_LABEL[basis], 'cache-control': 'no-store' } })
})

api.get('/api/pantry/package/:period/general-ledger.csv', async c => {
  const ctx = await reader(c), period = c.req.param('period'), basis = await reportBasis(ctx.db, c.req.query('basis')),dimension=await dimensionScope(ctx.db,c.req.query('dimension'),c.req.query('dimensionValue'))
  const csv=await ledgerCsv(ctx.db,period,basis, dimension),range=monthBounds(period)
  await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:`General ledger · ${period}`,from:range.start,to:range.end,basis,report:'general-ledger',dimension:dimension?.kind,dimensionValue:dimension?.id})
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="pantry-general-ledger-${period}${suffix(basis)}.csv"`, 'x-pantry-basis': BASIS_LABEL[basis], 'cache-control': 'no-store' } })
})

api.post('/api/pantry/command/:op', async c => {
  const command = commands[c.req.param('op')]
  requireThat(command, 'Unknown action', 404)
  const actor: Actor = await person(c.req.raw, c.env)
  must(actor, command.need)
  requireThat(Number(c.req.header('content-length') ?? 0) <= 8_000_000, 'Request too large', 413)
  const body = await c.req.json().catch(() => { throw new Fault(400, 'Send a JSON object') })
  requireThat(body && typeof body === 'object' && !Array.isArray(body), 'Send a JSON object')
  const ctx = { db: c.env.DB, env: c.env, request: c.req.raw, actor }
  await assertDoor(ctx, c.req.url, body as Data)
  return c.json(await projectAccess(ctx, await command.run(ctx, body as Data)))
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
