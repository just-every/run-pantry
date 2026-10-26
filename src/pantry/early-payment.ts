// INVOICE-010 early-payment terms, built to ct's ruling of 20 October 2026.
// Each tax code carries an explicit treatment: undecided until someone with the
// post grant records retain (the discount reduces only the price) or reduce (it
// also reduces taxable sales and tax). An invoice's term (p% within k days) is
// turned into an offer when the draft is saved and approved with that exact
// revision. The first write whose qualifying settlements reach the amount to
// settle posts a linked, system-marked credit in the same atomic batch: the
// discount to the discounts account and, on reduce lines only, the matching tax.
// It is all or nothing, never after the window, and a reversed payment that
// takes the settlements back below that amount reverses the credit with it.
import { dimensionTags, dimensionValues } from './dimensions'
import { authority, who } from './access'
import { addDays, daysBetween, longDay, now, optionalText, requireThat, scale, text, uid, usd, date, type Data } from './core'
import { all, audit, changed, guard, one, q, run, type AuditActor, type Sql } from './db'
import { milliPercent, percentLabel, spreadByWeight } from './discounts'
import { suggestionFor, SUGGESTIONS, TREATMENT_TABLE_NOTE, TREATMENT_TABLE_VERSION } from './early-payment-table'
import type { Command } from './context'
import { invoice, issueStatements, nextNumber } from './invoices'
import { entry, reversalStatements } from './journal'

export type Terms = { percentMilli: number; days: number }
type CodeSnapshot = { id: string; name: string; state: string; rate: number; treatment: string; revision: string | null; source: Data | null }
export type OfferLine = { lineNo: number; net: number; tax: number; discount: number; reduction: number; code: CodeSnapshot | null }
export type Offer = { percentMilli: number; days: number; windowEnd: string; base: number; discount: number; reduction: number; total: number; settle: number; deposit: number; payBy: number; accountId: string | null; lines: OfferLine[] }

/** The term as entered: p more than 0% and less than 100% (three decimals); k whole days from 1 to the days until the due date. */
export function parseTerms(raw: unknown, issueDate: string, dueDate: string, kind: string): Terms | null {
  if (raw === undefined || raw === null || raw === '') return null
  requireThat(kind !== 'credit', 'A credit carries no early-payment term')
  const t = raw as Data
  const percentMilli = milliPercent(t.percent, 'Early-payment discount', 100, false)
  const days = Number(t.days), span = daysBetween(issueDate, dueDate)
  requireThat(Number.isInteger(days) && days >= 1 && days <= span, `The early-payment window is 1 to ${span} whole days, ending no later than the due date`)
  return { percentMilli, days }
}

type Priced = { amount: number; discount: number; tax: number; taxCode: string | null }

/** R3: B is the lines' pre-tax net; D = B × p half up, spread by largest remainder; reduce lines give back tᵢ − tax(nᵢ − dᵢ). */
export async function computeOffer(db: D1Database, terms: Terms, issueDate: string, lines: Priced[], total: number, deposit: number, accountId: string | null): Promise<Offer> {
  const codes = new Map((await all(db, 'SELECT * FROM pt_tax_codes')).map(c => [c.id, c]))
  const nets = lines.map(l => l.amount - l.discount)
  const base = nets.reduce((s, n) => s + n, 0), discount = scale(base, terms.percentMilli, 100000)
  const shares = spreadByWeight(nets, discount)
  const offerLines = lines.map((l, i) => {
    const c = l.taxCode && l.taxCode !== 'exempt' ? codes.get(l.taxCode) : null
    const code: CodeSnapshot | null = c ? { id: c.id, name: c.name, state: c.state, rate: c.rate_milli_percent, treatment: c.early_treatment, revision: c.early_treatment_revision, source: c.early_treatment_source ? JSON.parse(c.early_treatment_source) : null } : null
    const reduction = c && c.early_treatment === 'reduce' ? l.tax - scale(nets[i] - shares[i], c.rate_milli_percent, 100000) : 0
    return { lineNo: i + 1, net: nets[i], tax: l.tax, discount: shares[i], reduction, code }
  })
  const reduction = offerLines.reduce((s, l) => s + l.reduction, 0), settle = total - discount - reduction
  return { percentMilli: terms.percentMilli, days: terms.days, windowEnd: addDays(issueDate, terms.days), base, discount, reduction, total, settle, deposit, payBy: settle - deposit, accountId, lines: offerLines }
}

/** Why an invoice with this offer cannot be approved now, or null (R1.4: F1–F3). */
export async function offerRefusal(db: D1Database, offer: Offer | null) {
  if (!offer) return null
  const undecided = offer.lines.filter(l => l.code && l.code.treatment === 'undecided').map(l => `${l.code!.name} (${l.code!.state})`)
  if (undecided.length) return `Record the early-payment treatment of ${[...new Set(undecided)].join(', ')} before approving an invoice with an early-payment term`
  for (const l of offer.lines) if (l.code) {
    const current = await one(db, 'SELECT early_treatment_revision FROM pt_tax_codes WHERE id = ?', l.code.id)
    if ((current?.early_treatment_revision ?? null) !== l.code.revision) return `The early-payment treatment of ${l.code.name} changed after this draft was saved; save the draft again`
  }
  if (!offer.accountId) return 'No early-payment discounts account was chosen when this draft was saved: ask your accountant to choose one in Settings, then save the draft again'
  return null
}

/** Batch guards: the treatment revisions the offer relies on still stand. */
export const treatmentFence = (offer: Offer | null) => offer ? [...new Map(offer.lines.filter(l => l.code).map(l => [l.code!.id, l.code!])).values()]
  .map(c => guard('(SELECT early_treatment_revision FROM pt_tax_codes WHERE id = ?) IS ?', c.id, c.revision)) : []

/** R1.5: what the PDF and hosted page say about the offer: the offer, then its tax effect. */
export function offerText(offer: Offer): [string, string] {
  const tax = offer.lines.reduce((s, l) => s + l.tax, 0)
  const byCode = new Map<string, { name: string; tax: number; reduction: number; reduce: boolean }>()
  for (const l of offer.lines) if (l.code) {
    const row = byCode.get(l.code.id) ?? { name: l.code.name, tax: 0, reduction: 0, reduce: l.code.treatment === 'reduce' }
    row.tax += l.tax; row.reduction += l.reduction; byCode.set(l.code.id, row)
  }
  const reduce = [...byCode.values()].some(c => c.reduce)
  const effect = !reduce ? `Sales tax stays ${usd(tax)}.`
    : byCode.size === 1 ? `Sales tax on the discounted price: ${usd(tax - offer.reduction)}.`
    : [...byCode.values()].map(c => c.reduce ? `${c.name}: sales tax on the discounted price ${usd(c.tax - c.reduction)}` : `${c.name}: sales tax stays ${usd(c.tax)}`).join('; ') + '.'
  return [`Early-payment discount: ${percentLabel(offer.percentMilli)} if paid by ${longDay(offer.windowEnd)}. Pay ${usd(offer.payBy)} by then.`, effect]
}

const parse = <T>(v: unknown): T | null => typeof v === 'string' ? JSON.parse(v) : (v as T) ?? null

/** The standing (not reversed) discount credit on an invoice, if any. */
export const standingDiscount = (db: D1Database, invoiceId: string) =>
  one(db, 'SELECT * FROM pt_invoices WHERE credit_for = ? AND early_discount = 1 AND early_reversal_id IS NULL', invoiceId)

/** Settlements that count toward the offer: standing payment allocations marked as counted (R4.1). */
export async function countedSettlements(db: D1Database, invoiceId: string) {
  return Number((await one(db, `SELECT COALESCE(SUM(a.amount_cents), 0) AS n FROM pt_allocations a JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
    WHERE a.target_kind = 'invoice' AND a.target_id = ? AND a.early_counted = 1 AND a.voided_by IS NULL AND p.reversal_id IS NULL`, invoiceId))?.n ?? 0)
}

/** Where an offer stands for a business day: live with the amount still due for it, taken, withdrawn or ended. */
export async function offerState(db: D1Database, inv: Data, today: string) {
  const offer = parse<Offer>(inv.early_offer)
  if (!offer || inv.kind !== 'invoice' || inv.status !== 'issued') return null
  const taken = await standingDiscount(db, inv.id)
  if (taken) return { offer, state: 'taken' as const, credit: taken.number as string, due: 0 }
  if (inv.early_withdrawn_by) return { offer, state: 'withdrawn' as const, credit: (await one(db, 'SELECT number FROM pt_invoices WHERE id = ?', inv.early_withdrawn_by))?.number as string, due: inv.open_cents }
  if (today > offer.windowEnd) return { offer, state: 'ended' as const, credit: null, due: inv.open_cents }
  return { offer, state: 'live' as const, credit: null, due: Math.max(0, offer.settle - await countedSettlements(db, inv.id)) }
}

export type Incoming = { targetId: string; amount: number }

/**
 * R4/R5 inside the payment's own batch: for each allocation to an invoice with an offer, whether it counts
 * (dated on or before the window end, or from a Checkout session created in the window for the early-pay
 * amount), and when it first brings counted settlements to the amount to settle, the discount credit, posted
 * and allocated before the payment's allocation, which is capped at what then remains.
 */
export async function takeEarlyDiscounts(db: D1Database, actor: AuditActor, list: Incoming[], day: string, opts: { sessionCounts?: boolean; payments?: string; issuing?: Data; qualifyingDate?: string } = {}) {
  const before: Sql[] = [], after: Sql[] = []
  const out: (Incoming & { counted: boolean })[] = []
  for (const a of list) {
    const inv = opts.issuing?.id===a.targetId ? opts.issuing : await one(db, "SELECT * FROM pt_invoices WHERE id = ? AND kind = 'invoice'", a.targetId)
    const offer = inv ? parse<Offer>(inv.early_offer) : null
    const counted = !!offer && inv!.status === 'issued' && ((opts.qualifyingDate ?? day) <= offer.windowEnd || !!opts.sessionCounts)
    if (!counted || inv!.early_withdrawn_by || await standingDiscount(db, inv!.id)) { out.push({ ...a, counted }); continue }
    const settled = await countedSettlements(db, inv!.id)
    if (settled + a.amount < offer!.settle) { out.push({ ...a, counted }); continue }
    const full = opts.issuing?.id===a.targetId ? opts.issuing : await invoice(db, inv!.id)
    const credited = offer!.discount + offer!.reduction
    const capped = Math.min(a.amount, (full.open_cents ?? full.total_cents) - credited)
    requireThat(capped > 0, `${full.number} has no balance left once its early-payment discount applies`, 409)
    const originals = full.lines as Data[]
    const lines = offer!.lines.filter(l => l.discount > 0).map(l => {
      const original = originals.find(o => o.line_no === l.lineNo)!
      return { ...dimensionTags(original),id: uid(), ref: original.id, account_id: offer!.accountId!, amount_cents: l.discount, description: `Early-payment discount ${percentLabel(offer!.percentMilli)} · ${original.description}`, tax_code: original.tax_code as string | null, tax_cents: l.reduction, treatment: l.code ? l.code.treatment : 'exempt' }
    })
    const id = uid(), revision = uid(), number = await nextNumber(db, 'credit')
    const approvalId = (await one(db, "SELECT id FROM pt_approvals WHERE subject_kind = 'invoice' AND subject_id = ? AND decision = 'approved' ORDER BY at DESC, rowid DESC LIMIT 1", full.id))?.id ?? null
    const payments = [...(await all(db, `SELECT a.source_id AS payment, a.amount_cents AS amount, a.allocation_date AS date FROM pt_allocations a JOIN pt_payments p ON p.id = a.source_id AND a.source_kind = 'payment'
      WHERE a.target_kind = 'invoice' AND a.target_id = ? AND a.early_counted = 1 AND a.voided_by IS NULL AND p.reversal_id IS NULL ORDER BY a.allocation_date, a.created_at`, full.id)), { payment: opts.payments ?? 'this payment', amount: capped, date: day }]
    const detail = { invoice: full.number, takenOn: day, windowEnd: offer!.windowEnd, base: offer!.base, discount: offer!.discount, reduction: offer!.reduction, settle: offer!.settle, approval: approvalId,
      treatments: Object.fromEntries(offer!.lines.filter(l => l.code).map(l => [l.code!.id, { treatment: l.code!.treatment, revision: l.code!.revision }])), payments,
      lines: offer!.lines.map(l => ({ line: l.lineNo, net: l.net, discount: l.discount, reduction: l.reduction, treatment: l.code ? l.code.treatment : 'exempt' })) }
    before.push(
      guard("EXISTS (SELECT 1 FROM pt_invoices WHERE id = ? AND revision = ? AND status = 'issued' AND early_withdrawn_by IS NULL)", full.id, full.revision),
      q("INSERT INTO pt_invoices (id, kind, number, customer_id, destination_state, issue_date, due_date, status, memo, credit_for, subtotal_cents, tax_cents, total_cents, opening, prepared_by, approved_by, approved_revision, revision, created_at, early_discount, early_detail) VALUES (?, 'credit', ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1, ?)",
        id, number, full.customer_id, full.destination_state ?? '', day, day, `Early-payment discount on ${full.number}, taken on ${longDay(day)} (window ended ${longDay(offer!.windowEnd)})`, full.id, offer!.discount, offer!.reduction, credited, actor.email, full.approved_by, revision, revision, now(), JSON.stringify(detail)),
      ...lines.map((l, i) => q("INSERT INTO pt_invoice_lines (id, invoice_id, line_no, description, quantity_milli, unit_cents, amount_cents, account_id, tax_code, tax_cents, chosen_tax_code, line_kind, discount_cents, early_treatment, early_line_ref, class_name, location_name, project_name) VALUES (?, ?, ?, ?, 1000, ?, ?, ?, ?, ?, ?, 'item', 0, ?, ?, ?, ?, ?)",
        l.id, id, i + 1, l.description, l.amount_cents, l.amount_cents, l.account_id, l.tax_code, l.tax_cents, l.tax_code, l.treatment, l.ref,...dimensionValues(l))))
    const issued = await issueStatements(db, { id, kind: 'credit', number, customer_id: full.customer_id, customer_name: full.customer_name, issue_date: day, total_cents: credited, credit_for: full.id, revision,
      destination_state: full.destination_state, early_for_number: full.number, lines }, actor)
    before.push(...issued.statements, audit(actor, 'invoice.early-discount', 'invoice', full.id, { credit: number, ...detail }))
    after.push(guard(`(SELECT COALESCE(SUM(a.amount_cents), 0) FROM pt_allocations a JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
      WHERE a.target_kind = 'invoice' AND a.target_id = ? AND a.early_counted = 1 AND a.voided_by IS NULL AND p.reversal_id IS NULL) + ? >= ?`, full.id, a.amount - capped, offer!.settle))
    out.push({ targetId: a.targetId, amount: capped, counted })
  }
  return { allocations: out, before, after }
}

/** R4.8: reversing a counted payment that takes settlements back below the amount to settle reverses the discount credit in the same write. */
export async function reverseEarlyDiscounts(db: D1Database, actor: AuditActor, paymentId: string, day: string, reason: string, removedByInvoice?: ReadonlyMap<string, number>) {
  const statements: Sql[] = []
  const targets = await all(db, "SELECT target_id, SUM(amount_cents) AS n FROM pt_allocations WHERE source_kind = 'payment' AND source_id = ? AND target_kind = 'invoice' AND early_counted = 1 AND voided_by IS NULL GROUP BY target_id", paymentId)
  for (const t of targets) {
    if (removedByInvoice && !(removedByInvoice.get(t.target_id) ?? 0)) continue
    const credit = await standingDiscount(db, t.target_id)
    if (!credit || JSON.parse(credit.early_detail ?? '{}').honoredAfterWindow) continue
    const inv = (await one(db, 'SELECT number, early_offer FROM pt_invoices WHERE id = ?', t.target_id))!, offer = parse<Offer>(inv.early_offer)!
    if (await countedSettlements(db, t.target_id) - (removedByInvoice ? removedByInvoice.get(t.target_id)! : Number(t.n)) >= offer.settle) continue
    statements.push(...await discountReversal(db, actor, credit, inv.number, day, reason))
  }
  return statements
}

async function discountReversal(db: D1Database, actor: AuditActor, credit: Data, invoiceNumber: string, day: string, reason: string) {
  const r = await reversalStatements(db, actor, await entry(db, credit.journal_id), day, `Early-payment discount ${credit.number} on ${invoiceNumber} reversed: ${reason}`)
  return [...r.statements,
    q('UPDATE pt_invoices SET early_reversal_id = ? WHERE id = ? AND early_reversal_id IS NULL', r.id, credit.id), changed(),
    q("UPDATE pt_allocations SET voided_on = ?, voided_by = ? WHERE source_kind = 'credit' AND source_id = ? AND voided_by IS NULL", day, r.id, credit.id),
    audit(actor, 'invoice.early-discount-reversed', 'invoice', credit.credit_for, { credit: credit.number, reversal: r.id, date: day, reason })]
}

/** R4.7: any other credit applied before the discount is taken withdraws the offer; the page names that credit. */
export async function withdrawalStatements(db: D1Database, actor: AuditActor, target: Data, creditId: string, creditNumber: string): Promise<Sql[]> {
  if (!target.early_offer || target.early_withdrawn_by || await standingDiscount(db, target.id)) return []
  return [q("UPDATE pt_invoices SET early_withdrawn_by = ? WHERE id = ? AND early_withdrawn_by IS NULL AND NOT EXISTS (SELECT 1 FROM pt_invoices d WHERE d.credit_for = ? AND d.early_discount = 1 AND d.early_reversal_id IS NULL)", creditId, target.id, target.id),
    audit(actor, 'invoice.early-offer-withdrawn', 'invoice', target.id, { credit: creditNumber })]
}

/** R2: someone with the post grant records a code's treatment with its source and, against or without a suggestion, a reason. */
const decide: Command = { need: 'post', async run(c, b) {
  const code = await one(c.db, 'SELECT * FROM pt_tax_codes WHERE id = ?', text(b.id, 'Tax code'))
  requireThat(code, 'Tax code not found', 404)
  requireThat(code.revision === b.revision, 'Tax code changed; reload', 409)
  const treatment = text(b.treatment, 'Early-payment treatment')
  requireThat(treatment === 'retain' || treatment === 'reduce', 'The early-payment treatment is retain or reduce')
  const row = suggestionFor(code.state), given = (b.source ?? {}) as Data
  const source = { url: optionalText(given.url, 'Source address', 500) || row?.source.url || '', section: optionalText(given.section, 'Source section', 300) || row?.source.section || '', date: given.date ? date(given.date, 'Source date') : row?.source.date ?? '' }
  requireThat(/^https:\/\/\S+$/.test(source.url) && source.section && source.date, 'Give the source of this treatment: its https address, section and date')
  const against = !!row && row.suggested !== treatment
  const reason = optionalText(b.reason, 'Reason', 1000)
  requireThat(reason || (row && !against), row ? `${code.state}'s suggestion is ${row.suggested}${row.required ? ' (required by the source)' : ''}; give the reason for choosing ${treatment}` : `There is no suggestion for ${code.state || 'this code'}; give the reason for this treatment`)
  const before = { treatment: code.early_treatment, revision: code.early_treatment_revision, source: code.early_treatment_source ? JSON.parse(code.early_treatment_source) : null, reason: code.early_treatment_reason }
  const after = { treatment, revision: uid(), source, reason }
  await run(c.db, [authority(c.actor, 'post'),
    q('UPDATE pt_tax_codes SET early_treatment = ?, early_treatment_revision = ?, early_treatment_source = ?, early_treatment_reason = ?, early_treatment_by = ?, early_treatment_at = ?, revision = ? WHERE id = ? AND revision = ?',
      treatment, after.revision, JSON.stringify(source), reason, c.actor.email, now(), uid(), code.id, b.revision), changed(),
    audit(who(c.actor), 'tax-code.early-treatment', 'tax-code', code.id, { before, after, suggestion: row ? { state: row.state, suggested: row.suggested, required: row.required } : null, againstSuggestion: against, table: TREATMENT_TABLE_VERSION })])
  return taxCodeTreatment(c.db, code.id)
} }

/** R8.6: someone with the post grant reverses a standing discount credit outside a payment reversal, with a reason. */
const reverseDiscount: Command = { need: 'post', async run(c, b) {
  const credit = await one(c.db, 'SELECT * FROM pt_invoices WHERE id = ? AND early_discount = 1', text(b.id, 'Early-payment discount credit'))
  requireThat(credit, 'Early-payment discount credit not found', 404)
  requireThat(!credit.early_reversal_id, 'This early-payment discount is already reversed', 409)
  const reason = text(b.reason, 'Reason', 500), day = date(b.date, 'Reversal date')
  const inv = (await one(c.db, 'SELECT number FROM pt_invoices WHERE id = ?', credit.credit_for))!
  await run(c.db, [authority(c.actor, 'post'), ...await discountReversal(c.db, who(c.actor), credit, inv.number, day, reason)])
  return (await one(c.db, 'SELECT id, number, early_reversal_id FROM pt_invoices WHERE id = ?', credit.id))!
} }

export const earlyPaymentCommands: Record<string, Command> = { 'tax-code.early-treatment': decide, 'early-discount.reverse': reverseDiscount }

/** A code's treatment with the suggestion it is measured against and whether the choice goes against it. */
export async function taxCodeTreatment(db: D1Database, id: string) {
  const code = (await one(db, 'SELECT * FROM pt_tax_codes WHERE id = ?', id))!
  const row = suggestionFor(code.state)
  return { ...code, early_treatment_source: code.early_treatment_source ? JSON.parse(code.early_treatment_source) : null, suggestion: row, against_suggestion: !!row && code.early_treatment !== 'undecided' && row.suggested !== code.early_treatment }
}

export async function treatmentsView(db: D1Database) {
  const codes = await all(db, 'SELECT id FROM pt_tax_codes ORDER BY state, name')
  return { version: TREATMENT_TABLE_VERSION, note: TREATMENT_TABLE_NOTE, suggestions: SUGGESTIONS, codes: await Promise.all(codes.map(c => taxCodeTreatment(db, c.id))) }
}
