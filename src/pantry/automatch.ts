// Deposits naming an invoice number or its customer payment reference clear automatically.
// Both paths record, allocate and match atomically, with an undoable receipt.
import { pantry } from './access'
import { Fault, usd, type Data } from './core'
import { all, one, run } from './db'
import { matchPlan } from './matching'
import { recordedPaymentCandidates } from './recorded-payments'
import { offerState } from './early-payment'

const canonical = (s: string) => s.normalize('NFKD').toUpperCase().replace(/\p{M}/gu, '')
/** Name the complete value, ignoring case and separators, without accepting a prefix. */
function names(deposit: string, value: string) {
  const letters = canonical(value).replace(/[^\p{L}\p{N}]+/gu, '')
  if (!letters) return false
  const gap = '[^\\p{L}\\p{N}]'
  return new RegExp(`(?:^|${gap})${[...letters].join(gap + '*')}(?:$|${gap})`, 'u').test(canonical(deposit))
}

type Candidate = { id: string; number: string; customer_id: string; customer_name: string; bank_reference: string; open_cents: number; early_due?: number; window_end?: string }

/** Open invoices with their balances, the pool deposits are compared against. */
async function openInvoices(db: D1Database): Promise<Candidate[]> {
  const rows = await all<Candidate & Data>(db, `SELECT i.id, i.number, i.customer_id, i.kind, i.status, i.early_offer, i.early_withdrawn_by, c.name AS customer_name, c.bank_reference,
      i.total_cents - COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
        WHERE a.target_kind = 'invoice' AND a.target_id = i.id AND (a.source_kind = 'credit' OR p.reversal_id IS NULL) AND a.voided_by IS NULL), 0) AS open_cents
    FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.kind = 'invoice' AND i.status = 'issued'`)
  // A live early-payment offer (INVOICE-010) also takes a deposit of the amount still due for its discount, dated in its window.
  for (const r of rows) if (r.early_offer) {
    const early = await offerState(db, r, '0000-00-00')
    if (early?.state === 'live' && early.due > 0) Object.assign(r, { early_due: early.due, window_end: early.offer.windowEnd })
  }
  return rows
}

/** What Pantry makes of one deposit line: the single invoice it pays, or why a person should decide. */
export function judge(line: Data, invoices: Candidate[]): { invoice?: Candidate; namedInvoice?: boolean; reason?: string; possible: Candidate[] } {
  if (line.amount_cents <= 0) return { possible: [] }
  const words = `${line.description} ${line.reference}`
  const same = invoices.filter(i => i.open_cents === line.amount_cents || (i.early_due === line.amount_cents && line.posted_date <= i.window_end!))
  if (!same.length) return { possible: [] }
  const byNumber = same.filter(i => names(words, i.number))
  if (byNumber.length === 1) return { invoice: byNumber[0], namedInvoice: true, possible: same }
  const byCustomer = same.filter(i => names(words, i.bank_reference))
  if (!byNumber.length && byCustomer.length === 1) return { invoice: byCustomer[0], namedInvoice: true, possible: same }
  if (!byNumber.length && !byCustomer.length && same.length === 1) return { invoice: same[0], possible: same }
  const named = byNumber.length ? byNumber : byCustomer
  if (named.length > 1) return { possible: named, reason: `${named.length} open invoices of ${usd(line.amount_cents)} fit this deposit (${named.map(i => i.number).join(', ')}); choose the one it pays` }
  return { possible: same, reason: `Same amount as ${same.map(i => `${i.number} (${i.customer_name})`).join(', ')}, but the deposit names neither the invoice nor the customer's bank reference; confirm it` }
}

/** Clear a deposit naming one open invoice by number or customer payment reference. Amount-only suggestions wait. */
export async function matchDeposits(db: D1Database, lineIds: string[]) {
  const matched: Data[] = []
  if (!lineIds.length) return { matched, needsPerson: [], proposed: [] }
  const lines = await all(db, `SELECT * FROM pt_bank_lines WHERE amount_cents > 0 AND removed_at IS NULL AND excluded_at IS NULL AND id IN (${lineIds.map(() => '?').join(',')}) ORDER BY posted_date, id`, ...lineIds)
  for (const line of lines) {
    if (await one(db, 'SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1', line.id)) continue
    const decision = judge(line, await openInvoices(db)), inv = decision.invoice
    if (!inv || !decision.namedInvoice) continue
    const amount = (line.amount_cents / 100).toFixed(2)
    try {
      const plan = await matchPlan(db, pantry('auto-match'), { bankLineIds: [line.id], journalLineIds: [],
        create: [{ type: 'receipt', contactId: inv.customer_id, amount, date: line.posted_date,
          reference: line.reference || inv.number, memo: `Automatic deposit for ${inv.number}`, allocations: [{ targetId: inv.id, amount }] }],
        note: `Matched automatically: deposit names ${inv.number} (${inv.customer_name})` }, { automatic: true })
      await run(db, plan.statements)
      matched.push({ lineId: line.id, matchId: plan.id, invoiceId: inv.id, invoice: inv.number, customer: inv.customer_name, amount: line.amount_cents })
    } catch (error) { if (!(error instanceof Fault)) throw error }
  }
  const remaining = lines.filter(l => !matched.some(m => m.lineId === l.id))
  const proposals = await depositProposals(db, remaining), invoices = await openInvoices(db)
  return { matched, proposed: Object.values(proposals), needsPerson: remaining.filter(l => !proposals[l.id]).flatMap(l => { const reason = judge(l, invoices).reason; return reason ? [{ lineId: l.id, description: l.description, reason }] : [] }) }
}

/** Current suggestions, shared by the transaction queue and reconciliation. */
export async function depositProposals(db: D1Database, lines: Data[]) {
  const invoices = await openInvoices(db), proposals: Record<string, Data> = {}
  for (const line of lines) {
    if (line.match_id || line.removed_at || line.excluded_at) continue
    const inv = judge(line, invoices).invoice
    if (inv) proposals[line.id] = { lineId: line.id, invoiceId: inv.id, invoice: inv.number, customerId: inv.customer_id, customer: inv.customer_name, amount: line.amount_cents }
  }
  return proposals
}

/** Payments recorded before their bank line arrived. A new line of exactly a recorded payment's amount, on its bank
 * account within a week of its date, that names its customer or vendor (or the payment's reference), clears that
 * payment's bank posting: nothing new is posted. Only a single such payment matches; anything else waits for a person. */
export async function matchRecorded(db: D1Database, lineIds: string[]) {
  const matched: Data[] = []
  if (!lineIds.length) return matched
  const lines = await all(db, `SELECT * FROM pt_bank_lines WHERE removed_at IS NULL AND excluded_at IS NULL AND id IN (${lineIds.map(() => '?').join(',')}) ORDER BY posted_date, id`, ...lineIds)
  for (const line of lines) {
    if (await one(db, 'SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1', line.id)) continue
    const candidates = (await recordedPaymentCandidates(db, [line]))[line.id] ?? []
    // Card-funded bill payments wait for the person's review; other recorded
    // payments retain their established automatic clearing behaviour.
    const named = candidates.filter(p => p.named)
    if (named.length !== 1) continue
    const p = named[0]
    if (p.direction === 'paid' && p.method === 'card') continue
    try {
      const plan = await matchPlan(db, pantry('auto-match'), { bankLineIds: [line.id], journalLineIds: [p.journalLineId], create: [],
        note: `Matched automatically: the ${usd(Math.abs(line.amount_cents))} payment ${p.direction === 'paid' ? 'to' : 'from'} ${p.vendor} recorded on ${p.payment_date}` }, { automatic: true })
      await run(db, plan.statements)
      matched.push({ lineId: line.id, matchId: plan.id, payment: p.paymentId, contact: p.vendor, amount: line.amount_cents })
    } catch (error) { if (!(error instanceof Fault)) throw error }
  }
  return matched
}

/** For the reconciliation screen: why each unmatched deposit waits for a person. */
export async function depositNotes(db: D1Database, lines: Data[]) {
  const open = lines.filter(l => !l.match_id && l.amount_cents > 0)
  if (!open.length) return {}
  const invoices = await openInvoices(db), notes: Record<string, string> = {}
  for (const l of open) { const v = judge(l, invoices); if (v.reason) notes[l.id] = v.reason; else if (v.invoice) notes[l.id] = `Pays ${v.invoice.number} (${v.invoice.customer_name})` }
  return notes
}
