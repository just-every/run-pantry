import { refunded } from './refunds/store'
import { lateDiscountChecks } from './late-discount'
import { writeOffChecks } from './approved-write-offs'
import { dimensionTags, dimensionValues } from './dimensions'
import { dimensionAmounts } from './dimensions/allocations'
import { depositForIssue } from './customer-deposits/applications'
// Receivables: draft → approved → issued invoices, and credits that reduce them.
// A line without a decided tax treatment stops the invoice at review; Pantry
// never assumes zero tax.
import { bankAuthority } from './access-policy/banks'
import { invoiceTime } from './time/invoicing'
import { withinLimit } from './issuing-limits'
import { authority, must, who } from './access'
import { addDays, date, list, now, optionalText, quantity, requireThat, scale, text, uid, cents, type Data } from './core'
import { all, approval, assertOpen, audit, changed, one, periodOpen, q, run, type AuditActor, type Sql } from './db'
import { controlAccount } from './accounts'
import { contact } from './contacts'
import { entryStatements, type Line } from './journal'
import type { Command } from './context'
import { documentSelectionStatements, issuedDocumentStatements } from './invoice-documents'
import { customValues, nextInvoiceNumber, selectedTemplate } from './invoice-templates'
import { applicableExemption, assertInvoiceExemption, destinationState, exemptionDay, exemptionFence } from './exemptions'
import { afterTaxShares, applyDiscounts, discountSettings, parseDeposit, type Deposit } from './discounts'
import { paymentStatements } from './payables'
import { computeOffer, offerRefusal, parseTerms, treatmentFence, withdrawalStatements, type Offer } from './early-payment'

const parsed = <T>(value: unknown, fallback: T): T => typeof value === 'string' ? JSON.parse(value) : (value as T) ?? fallback

export async function invoice(db: D1Database, id: string) {
  const row = await one(db, 'SELECT i.*, c.name AS customer_name, c.email AS customer_email FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.id = ?', id)
  requireThat(row, 'Invoice not found', 404)
  row.exemption = row.exemption_evidence ? JSON.parse(row.exemption_evidence) : null
  row.discounts = parsed(row.discounts, []); row.deposit = parsed(row.deposit, null)
  row.early_terms = parsed(row.early_terms, null); row.early_offer = parsed(row.early_offer, null); row.early_detail = parsed(row.early_detail, null)
  row.lines = await all(db, 'SELECT * FROM pt_invoice_lines WHERE invoice_id = ? ORDER BY line_no', id)
  row.disputed_cents=Number((await one(db,'SELECT COALESCE(SUM(disputed_cents),0) AS n FROM pt_stripe_payments WHERE invoice_id=?',id))?.n??0)
  if (row.void_date) row.status = 'void'
  row.open_cents = row.status === 'void' ? 0 : row.kind === 'credit' && row.status === 'issued' ? (row.early_reversal_id ? 0 : row.total_cents - Number((await one(db, "SELECT COALESCE(SUM(amount_cents),0) AS n FROM pt_allocations WHERE source_kind='credit' AND source_id=? AND voided_by IS NULL", id))?.n ?? 0) - await refunded(db, 'credit', id)) : await openBalance(db, 'invoice', id, row.total_cents)
  return row
}

/** Amount still owed: total less allocations from payments that stand and from credits. */
export async function openBalance(db: D1Database, kind: 'invoice' | 'bill', id: string, total: number, asOf = '9999-12-31') {
  const r = await one<{ applied: number }>(db, `SELECT COALESCE(SUM(a.amount_cents), 0) AS applied FROM pt_allocations a
    LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
    WHERE a.target_kind = ? AND a.target_id = ? AND a.allocation_date <= ? AND (a.source_kind = 'credit' OR p.reversal_id IS NULL) AND (a.voided_on IS NULL OR a.voided_on > ?)`, kind, id, asOf, asOf)
  return total - Number(r?.applied ?? 0)
}

export async function parseInvoice(db: D1Database, b: Data, options: { estimate?: boolean } = {}) {
  const customer = await contact(db, text(b.customerId, 'Customer'), 'customer')
  requireThat(customer.active, 'Customer is inactive')
  const issueDate = date(b.issueDate, 'Issue date')
  const documentTemplate = await selectedTemplate(db, customer, b.templateId)
  const documentValues = customValues(documentTemplate, b.customFields)
  const dueDate = b.dueDate ? date(b.dueDate, 'Due date') : addDays(issueDate, customer.invoice_terms_override ? customer.terms_days : documentTemplate.termsDays)
  requireThat(dueDate >= issueDate, 'Due date is on or after the issue date')
  const destination = destinationState(b.destinationState)
  const exemption = b.kind === 'credit' ? null : await applicableExemption(db, customer.id, destination, issueDate)
  const taxCodes = new Map((await all(db, 'SELECT * FROM pt_tax_codes WHERE active = 1')).map(t => [t.id, t]))
  const accounts = new Map((await all(db, "SELECT id, type, active FROM pt_accounts")).map(a => [a.id, a]))
  const items = new Map((await all(db, 'SELECT * FROM pt_items')).map(it => [it.id, it]))
  const credit = b.kind === 'credit'
  const priced = list<Data>(b.lines, 'Invoice lines', 100).map((l, i) => {
    const label = `Line ${i + 1}`
    // A delivery charge (INVOICE-010) is a line with its own tax code that subtotal discounts never reach.
    const kind = l.kind === undefined || l.kind === null || l.kind === '' || l.kind === 'item' ? 'item' as const : l.kind === 'delivery' ? 'delivery' as const : null
    requireThat(kind, `${label} is an item line or a delivery charge`)
    requireThat(kind === 'item' || !credit, `${label}: a credit carries item lines only`)
    requireThat(kind === 'item' || !l.itemId, `${label}: a delivery charge is not a product or service`)
    // A line sold as an item (ITEM-001) takes its description, rate, income account and tax category.
    const item = l.itemId ? items.get(String(l.itemId)) : null
    requireThat(!l.itemId || item, `${label}: unknown product or service`)
    requireThat(!item || item.active || b.kind === 'credit', `${label}: ${item?.name} is inactive; choose an active product or service`)
    const given = (v: unknown) => v !== undefined && v !== null && v !== ''
    const qty = quantity(l.quantity ?? '1', `${label} quantity`), unit = cents(item && !given(l.rate) ? String(item.rate_cents / 100) : l.rate, `${label} rate`, { zero: true })
    const amount = scale(qty, unit, 1000)
    requireThat(amount > 0, `${label} amount must be positive`)
    requireThat(!item || !given(l.accountId) || l.accountId === item.income_account_id, `${label}: ${item?.name} posts to its own income account`)
    const account = accounts.get(item ? item.income_account_id : text(l.accountId, `${label} income account`))
    requireThat(account && account.active && account.type === 'income', `${label}: choose an active income account`)
    let chosenCode = typeof l.taxCode === 'string' && l.taxCode ? l.taxCode : null
    requireThat(chosenCode === null || chosenCode === 'exempt' || taxCodes.has(chosenCode), `${label}: unknown sales tax code`)
    if (item?.tax_category === 'non-taxable') { requireThat(chosenCode === null || chosenCode === 'exempt', `${label}: ${item.name} is not taxable`); chosenCode = 'exempt' }
    else if (item && chosenCode === null && item.tax_code && taxCodes.has(item.tax_code)) chosenCode = item.tax_code
    const code = exemption ? 'exempt' : chosenCode
    const description = item && !given(l.description) ? item.description || item.name : text(l.description, `${label} description`, 500)
    return { ...dimensionTags(l), description, qty, unit, amount, kind, discount: 0, accountId: account.id, taxCode: code, chosenTaxCode: chosenCode, tax: 0, itemId: item ? item.id as string : null }
  })
  // Before-tax discounts reduce each line's taxable amount; tax is per line on what remains, rounded half up.
  const { discounts, afterTax } = applyDiscounts(b.discounts, priced, credit)
  const lines = priced.map(l => ({ ...l, tax: l.taxCode && l.taxCode !== 'exempt' ? scale(l.amount - l.discount, taxCodes.get(l.taxCode)!.rate_milli_percent, 100000) : 0 }))
  const subtotal = lines.reduce((s, l) => s + l.amount, 0), discount = lines.reduce((s, l) => s + l.discount, 0), tax = lines.reduce((s, l) => s + l.tax, 0)
  const total = subtotal - discount + tax - afterTax
  requireThat(total > 0, 'The invoice total after discounts is more than zero')
  const deposit = await parseDeposit(db, b.deposit, issueDate, total, credit)
  const settings = discounts.length || b.earlyPayment ? await discountSettings(db) : null
  const discountAccountId = discounts.length ? settings?.discount_account_id ?? null : null
  // An early-payment term (INVOICE-010) becomes an offer computed now and approved with this exact revision.
  const terms = parseTerms(b.earlyPayment, issueDate, dueDate, credit ? 'credit' : 'invoice')
  const offer: Offer | null = terms && !options.estimate ? await computeOffer(db, terms, issueDate, lines, total, deposit?.amount ?? 0, settings?.early_account_id ?? settings?.discount_account_id ?? null) : null
  requireThat(!offer || offer.payBy > 0, 'The deposit already covers the early-payment amount; lower the deposit or leave out the term')
  return { customer, documentTemplate, documentValues, issueDate, dueDate, destination, exemption, lines, subtotal, discount, afterTax, discounts, discountAccountId, deposit, terms, offer, tax, total, memo: optionalText(b.memo, 'Memo', 1000) }
}

/** The INVOICE-010 columns a draft keeps: discounts as entered, their parts, the discounts account and the deposit. */
export const discountColumns = (p: Awaited<ReturnType<typeof parseInvoice>>) => [JSON.stringify(p.discounts), p.discount, p.afterTax, p.discountAccountId, p.deposit ? JSON.stringify(p.deposit) : null, p.terms ? JSON.stringify(p.terms) : null, p.offer ? JSON.stringify(p.offer) : null]

export const lineStatements = (invoiceId: string, lines: Awaited<ReturnType<typeof parseInvoice>>['lines']) => lines.map((l, i) =>
  q('INSERT INTO pt_invoice_lines (id, invoice_id, line_no, description, quantity_milli, unit_cents, amount_cents, account_id, tax_code, tax_cents, chosen_tax_code, item_id, line_kind, discount_cents, class_name, location_name, project_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    uid(), invoiceId, i + 1, l.description, l.qty, l.unit, l.amount, l.accountId, l.taxCode, l.tax, l.chosenTaxCode, l.itemId, l.kind, l.discount,...dimensionValues(l)))

export async function nextNumber(db: D1Database, kind: 'invoice' | 'credit') {
  if (kind === 'invoice') return nextInvoiceNumber(db)
  const prefix = 'CR-'
  const rows = await all<{ number: string }>(db, 'SELECT number FROM pt_invoices WHERE number LIKE ?', prefix + '%')
  const n = rows.map(r => Number(r.number.slice(prefix.length))).filter(Number.isInteger).reduce((m, x) => Math.max(m, x), 0)
  return prefix + String(n + 1).padStart(4, '0')
}

const saveDraft: Command = { need: 'record', async run(c, b) {
  const kind = b.kind === 'credit' ? 'credit' : 'invoice'
  const previous = b.id ? await invoice(c.db, text(b.id, 'Invoice')) : null
  requireThat(!previous?.early_detail?.honoredAfterWindow, 'A late honor keeps the approved offer calculation; prepare a new honor instead', 409)
  requireThat(!previous?.write_off, 'A prepared write-off keeps its reviewed purpose and coding; prepare a new write-off instead', 409)
  requireThat(!previous?.estimate_id, 'A converted estimate draft keeps its accepted pricing; issue it without editing', 409)
  const time = await invoiceTime(c.db, b)
  const p = await parseInvoice(c.db, { ...time.body, templateId: b.templateId ?? previous?.document_template_id, customFields: b.customFields ?? (previous ? JSON.parse(previous.document_values) : undefined) })
  const depositScope = p.deposit ? bankAuthority(c.actor, [p.deposit.bankAccountId]) : []
  const certificateGuards = exemptionFence(p.exemption, p.customer.id, p.destination, p.issueDate, await exemptionDay(c.db))
  // A locked month refuses drafts dated in it, as journals do (PAN-13).
  await assertOpen(c.db, p.issueDate)
  let creditFor: string | null = null
  if (kind === 'credit') {
    const target = await invoice(c.db, text(b.creditFor, 'Invoice being credited'))
    requireThat(target.kind === 'invoice' && target.status === 'issued' && target.customer_id === p.customer.id, 'A credit applies to an issued invoice of the same customer')
    creditFor = target.id
  }
  if (b.id) {
    const current = await invoice(c.db, text(b.id, 'Invoice'))
    requireThat(['draft','approved'].includes(current.status), 'An issued invoice cannot change; issue a credit', 409)
    requireThat(current.revision === b.revision, 'Invoice changed; reload', 409)
    await assertOpen(c.db, current.issue_date)
    // Editing an approved invoice returns it to draft: approval covered the earlier revision.
    // The editor becomes the preparer, so whoever last changed it cannot approve it.
    await run(c.db, [authority(c.actor, 'record'), ...depositScope, ...certificateGuards, periodOpen(current.issue_date), periodOpen(p.issueDate),
      q("UPDATE pt_invoices SET customer_id = ?, destination_state = ?, exemption_evidence = ?, issue_date = ?, due_date = ?, status = 'draft', memo = ?, credit_for = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, discounts = ?, discount_cents = ?, after_tax_discount_cents = ?, discount_account_id = ?, deposit = ?, early_terms = ?, early_offer = ?, approved_by = NULL, approved_revision = NULL, prepared_by = ?, revision = ? WHERE id = ? AND revision = ? AND status IN ('draft','approved') AND void_date IS NULL",
        p.customer.id, p.destination, p.exemption ? JSON.stringify(p.exemption) : null, p.issueDate, p.dueDate, p.memo, creditFor, p.subtotal, p.tax, p.total, ...discountColumns(p), c.actor.email, uid(), current.id, b.revision), changed(),
      ...documentSelectionStatements(current.id, p), q('DELETE FROM pt_invoice_lines WHERE invoice_id = ?', current.id), ...lineStatements(current.id, p.lines),
      audit(who(c.actor), `${kind}.edit`, kind, current.id, { total: p.total, earlyOffer: p.offer })])
    return invoice(c.db, current.id)
  }
  const id = uid(), number = b.number ? text(b.number, 'Number', 40) : await nextNumber(c.db, kind)
  await run(c.db, [authority(c.actor, 'record'), ...depositScope, ...certificateGuards, periodOpen(p.issueDate),
    q("INSERT INTO pt_invoices (id, kind, number, customer_id, destination_state, exemption_evidence, issue_date, due_date, status, memo, credit_for, subtotal_cents, tax_cents, total_cents, discounts, discount_cents, after_tax_discount_cents, discount_account_id, deposit, early_terms, early_offer, opening, prepared_by, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
      id, kind, number, p.customer.id, p.destination, p.exemption ? JSON.stringify(p.exemption) : null, p.issueDate, p.dueDate, p.memo, creditFor, p.subtotal, p.tax, p.total, ...discountColumns(p), c.actor.email, uid(), now()),
    ...documentSelectionStatements(id, p), ...lineStatements(id, p.lines), ...time.claims(id), audit(who(c.actor), `${kind}.draft`, kind, id, { number, total: p.total, earlyOffer: p.offer })])
  return invoice(c.db, id)
} }

async function approvalChecks(db: D1Database, current: Data) {
  const certificateGuards = [...await assertInvoiceExemption(db, current), ...await writeOffChecks(db, current), ...await lateDiscountChecks(db, current)]
  const untaxed = current.lines.filter((l: Data) => !l.tax_code)
  requireThat(!untaxed.length, `Tax treatment needed before approval: line ${untaxed.map((l: Data) => l.line_no).join(', ')}`, 409)
  requireThat(!current.discounts.length || current.discount_account_id, 'No discounts account was chosen when this draft was saved: ask your accountant to choose one in Settings, then save the draft again', 409)
  const refusal = await offerRefusal(db, current.early_offer)
  requireThat(!refusal, refusal!, 409)
  await assertOpen(db, current.issue_date)
  return certificateGuards
}

const approve: Command = { need: 'post', async run(c, b) {
  const current = await invoice(c.db, text(b.id, 'Invoice'))
  requireThat(current.status === 'draft', 'Only a draft is approved', 409)
  requireThat(current.revision === b.revision, 'Invoice changed since you reviewed it; review it again', 409)
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || current.prepared_by !== c.actor.email), 'Someone other than the preparer approves this invoice', 403)
  if (current.kind === 'credit' && c.actor.kind === 'person' && c.actor.role !== 'owner') {
    const target = await invoice(c.db, current.credit_for)
    requireThat(!target.self_approval || JSON.parse(target.self_approval).person !== c.actor.email, 'A second person must approve a correction of your self-approved invoice', 403)
  }
  const certificateGuards = await approvalChecks(c.db, current)
  const revision = uid()
  await run(c.db, [authority(c.actor, 'post'), ...(current.deposit ? bankAuthority(c.actor, [current.deposit.bankAccountId]) : []), ...certificateGuards, ...treatmentFence(current.early_offer), periodOpen(current.issue_date), approval(who(c.actor), current.kind, current.id, current.revision, 'approve', 'approved', optionalText(b.note, 'Note', 500)),
    q("UPDATE pt_invoices SET status = 'approved', approved_by = ?, approved_revision = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'draft'", c.actor.email, revision, revision, current.id, b.revision), changed(),
    audit(who(c.actor), `${current.kind}.approve`, current.kind, current.id, current.early_offer ? { earlyOffer: current.early_offer } : {})])
  return invoice(c.db, current.id)
} }

/** The invoice fields issuing reads; an invoice being created in the same batch passes them directly. */
export type Issuable = { id: string; kind: string; number: string; customer_id: string; customer_name: string; issue_date: string; total_cents: number; credit_for?: string | null; revision: string; destination_state?: string; exemption_evidence?: string | null
  discounts?: import('./discounts').Discount[]; discount_cents?: number; after_tax_discount_cents?: number; discount_account_id?: string | null; deposit?: Deposit | null; early_offer?: Offer | null; early_for_number?: string; write_off?: number; early_detail?: Data; early_discount?: number
  lines: { account_id: string; amount_cents: number; description: string; tax_code: string | null; tax_cents: number; discount_cents?:number;line_kind?:string; class_name?:string;location_name?:string;project_name?:string }[] }

/** Issue posts the approved revision: receivable against income and sales tax (reversed for a credit). */
export async function issueStatements(db: D1Database, current: Issuable, actor: AuditActor, preparedBy = actor.email, parsed?: Data): Promise<{ journalId: string; statements: Sql[] }> {
  const certificateGuards = [...await assertInvoiceExemption(db, current), ...await writeOffChecks(db, current), ...await lateDiscountChecks(db, current)]
  const receivable = await controlAccount(db, 'receivable')
  const taxAccounts = new Map((await all(db, 'SELECT id, account_id FROM pt_tax_codes')).map(t => [t.id, t.account_id]))
  const credit = current.kind === 'credit'
  const side = (amount: number, debit: boolean) => debit ? { debit: amount, credit: 0 } : { debit: 0, credit: amount }
  const coded = current.lines.map((l,i) => ({...l,line_kind:parsed?.lines?.[i]?.kind??l.line_kind,...dimensionTags(parsed?.lines?.[i] ?? l),discount_cents: parsed?.lines?.[i]?.discount ?? l.discount_cents ?? 0}))
  const after=afterTaxShares(coded,parsed?.discounts??current.discounts??[],current.after_tax_discount_cents??0)
  const controls = dimensionAmounts(coded.map((l,i) => ({ source:l, amount:l.amount_cents-l.discount_cents-after[i]+l.tax_cents })))
    .map(({ amount,...tags }) => ({ ...tags, accountId:receivable.id, ...side(Math.abs(amount), amount > 0 ? !credit : credit), memo:`${current.number} ${current.customer_name}`, contactId:current.customer_id }))
  // Keep the first control at line 1 and the original sale lines at 2 onward.
  const lines: Line[] = [controls[0]]
  for (const l of coded) lines.push({ ...dimensionTags(l), accountId: l.account_id, ...side(l.amount_cents, credit), memo: l.description })
  // Keep sale line ordinals stable. Group additional postings only when their
  // account and all three reviewed dimension values agree.
  const extra = new Map<string, Line>()
  const add = (accountId:string,amount:number,debit:boolean,memo:string,source:Data) => {
    if (!amount) return
    const tags=dimensionTags(source),key=JSON.stringify([accountId,debit,...dimensionValues(tags)])
    const previous=extra.get(key)
    if(previous){previous.debit+=debit?amount:0;previous.credit+=debit?0:amount}
    else extra.set(key,{...tags,accountId,...side(amount,debit),memo})
  }
  coded.forEach((l,i)=>add(current.discount_account_id!,l.discount_cents+after[i],!credit,`Discounts ${current.number}`,l))
  for (const l of coded) add(taxAccounts.get(l.tax_code!)!,l.tax_cents,credit,`Sales tax ${current.number}`,l)
  lines.push(...extra.values(), ...controls.slice(1))
  const lateHonor = !!current.early_detail?.honoredAfterWindow
  const issuedRevision = uid()
  const documents = await issuedDocumentStatements(db, current, issuedRevision, parsed)
  const journalId = uid(), statements: Sql[] = [
    ...certificateGuards,
    ...entryStatements({ id: journalId, date: current.issue_date, memo: `${credit ? 'Credit' : 'Invoice'} ${current.number} — ${current.customer_name}`, sourceKind: current.kind, sourceId: current.id, preparedBy, preparedKind: 'person', lines }, actor.email),
    q("UPDATE pt_invoices SET status = 'issued', journal_id = ?, issued_by = ?, revision = ?, early_discount = ? WHERE id = ? AND revision = ? AND status = 'approved'", journalId, actor.email, issuedRevision, lateHonor || current.early_for_number || current.early_discount ? 1 : 0, current.id, current.revision), changed(), ...documents]
  if (current.deposit) {
    // The deposit received at issue is a payment applied to this invoice from its issue date.
    const d = current.deposit, deposit = await paymentStatements(db, actor, { ...dimensionTags(d), direction: 'received', contactId: current.customer_id, date: d.date, amount: (d.amount / 100).toFixed(2), method: d.method,
      bankAccountId: d.bankAccountId, reference: d.reference || current.number, memo: `Deposit received at issue of ${current.number}` })
    statements.push(...deposit.statements, q("INSERT INTO pt_allocations (id, source_kind, source_id, target_kind, target_id, amount_cents, allocation_date, created_by, created_at) VALUES (?, 'payment', ?, 'invoice', ?, ?, ?, ?, ?)", uid(), deposit.id, current.id, d.amount, current.issue_date, actor.email, now()),
      q('UPDATE pt_invoices SET deposit_payment_id = ? WHERE id = ?', deposit.id, current.id), changed(),
      q('UPDATE pt_allocations SET early_counted = 1 WHERE source_kind = ? AND source_id = ? AND ? = 1', 'payment', deposit.id, current.early_offer ? 1 : 0))
  }
  if (!credit) statements.push(...await depositForIssue(db, actor, {...current,revision:issuedRevision,status:'issued'}))
  if (credit) {
    const target = await invoice(db, current.credit_for!)
    // Any credit other than the early-payment discount itself withdraws a live early-payment offer (INVOICE-010).
    if (!current.early_for_number && !lateHonor) statements.push(...await withdrawalStatements(db, actor, target, current.id, current.number))
    const applied = Math.min(current.total_cents, target.open_cents)
    if (applied > 0) statements.push(q("INSERT INTO pt_allocations (id, source_kind, source_id, target_kind, target_id, amount_cents, allocation_date, created_by, created_at) VALUES (?, 'credit', ?, 'invoice', ?, ?, ?, ?, ?)", uid(), current.id, target.id, applied, current.issue_date, actor.email, now()))
  }
  statements.push(audit(actor, `${current.kind}.issue`, current.kind, current.id, { journal: journalId, total: current.total_cents }))
  return { journalId, statements }
}

const issue: Command = { need: 'record', async run(c, b) {
  const current = await invoice(c.db, text(b.id, 'Invoice'))
  if (current.write_off || current.early_detail?.honoredAfterWindow) must(c.actor, 'post')
  requireThat(current.status === 'approved' && current.approved_revision === current.revision, 'Approve the current version before issuing', 409)
  await assertOpen(c.db, current.issue_date)
  const issued = await issueStatements(c.db, current as Issuable, c.actor)
  await run(c.db, [authority(c.actor, 'record'), ...(current.write_off || current.early_detail?.honoredAfterWindow ? [authority(c.actor, 'post')] : []), ...issued.statements])
  return invoice(c.db, current.id)
} }

const approveIssue: Command = { need: 'post', async run(c, b) {
  const current = await invoice(c.db, text(b.id, 'Invoice'))
  requireThat(current.status === 'draft' && current.revision === b.revision, 'Draft changed; reload the current revision', 409)
  const self = await withinLimit(c.db, c.actor, current, b.limitRevision)
  const certificates = await approvalChecks(c.db, current)
  const approvedRevision = uid()
  const issued = await issueStatements(c.db, { ...current, revision: approvedRevision } as Issuable, c.actor, current.prepared_by)
  await run(c.db, [...self.fences, ...certificates, ...treatmentFence(current.early_offer), periodOpen(current.issue_date),
    approval(who(c.actor), current.kind, current.id, current.revision, 'approve', 'approved', self.note),
    q("UPDATE pt_invoices SET status = 'approved', approved_by = ?, approved_revision = ?, revision = ?, self_approval = ? WHERE id = ? AND revision = ? AND status = 'draft'", c.actor.email, approvedRevision, approvedRevision, JSON.stringify(self.detail), current.id, b.revision), changed(),
    audit(who(c.actor), `${current.kind}.approve`, current.kind, current.id, self.detail), ...issued.statements])
  return invoice(c.db, current.id)
} }

export const invoiceCommands: Record<string, Command> = {
  'invoice.approve-issue': approveIssue,
  'invoice.save-draft': saveDraft,
  'invoice.approve': approve,
  'invoice.issue': issue,
}

export async function invoicesView(db: D1Database) {
  const rows = await all(db, 'SELECT i.*, c.name AS customer_name, c.email AS customer_email FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id ORDER BY i.issue_date DESC, i.number DESC, i.id LIMIT 500')
  const lines = await all(db, 'SELECT * FROM pt_invoice_lines ORDER BY invoice_id, line_no')
  for (const r of rows) {
    r.exemption = r.exemption_evidence ? JSON.parse(r.exemption_evidence) : null
    r.discounts = parsed(r.discounts, []); r.deposit = parsed(r.deposit, null); r.early_offer = parsed(r.early_offer, null); r.early_detail = parsed(r.early_detail, null)
    r.lines = lines.filter(l => l.invoice_id === r.id)
    r.disputed_cents=Number((await one(db,'SELECT COALESCE(SUM(disputed_cents),0) AS n FROM pt_stripe_payments WHERE invoice_id=?',r.id))?.n??0)
    if (r.void_date) r.status = 'void'
    r.open_cents = r.status === 'void' ? 0 : r.kind === 'invoice' && r.status === 'issued' ? await openBalance(db, 'invoice', r.id, r.total_cents) : r.kind === 'credit' && r.status === 'issued' ? (r.early_reversal_id ? 0 : r.total_cents - await refunded(db, 'credit', r.id) - Number((await one(db, "SELECT COALESCE(SUM(amount_cents),0) AS n FROM pt_allocations WHERE source_kind = 'credit' AND source_id = ?", r.id))?.n ?? 0)) : r.total_cents
  }
  return rows
}
