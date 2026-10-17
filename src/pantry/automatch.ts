// Deposits that match their invoice by themselves. When a bank line arrives
// (imported today, from a feed later) whose amount equals one open invoice's
// balance and whose text names that invoice or its customer's bank reference,
// Pantry records the receipt and matches it, marked "matched automatically"
// with an undo. Anything less certain is left for a person, with the reason.
// A payment already recorded meets its own bank line the same way (matchRecorded).
import { pantry } from './access'
import { Fault, usd, type Data } from './core'
import { all, one, run } from './db'
import { matchPlan } from './matching'

const plain = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')

type Candidate = { id: string; number: string; customer_id: string; customer_name: string; bank_reference: string; open_cents: number }

/** Open invoices with their balances, the pool deposits are compared against. */
async function openInvoices(db: D1Database): Promise<Candidate[]> {
  return all<Candidate>(db, `SELECT i.id, i.number, i.customer_id, c.name AS customer_name, c.bank_reference,
      i.total_cents - COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
        WHERE a.target_kind = 'invoice' AND a.target_id = i.id AND (a.source_kind = 'credit' OR p.reversal_id IS NULL)), 0) AS open_cents
    FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.kind = 'invoice' AND i.status = 'issued'`)
}

/** What Pantry makes of one deposit line: the single invoice it pays, or why a person should decide. */
export function judge(line: Data, invoices: Candidate[]): { invoice?: Candidate; reason?: string; possible: Candidate[] } {
  if (line.amount_cents <= 0) return { possible: [] }
  const words = plain(`${line.description} ${line.reference}`)
  const same = invoices.filter(i => i.open_cents === line.amount_cents)
  if (!same.length) return { possible: [] }
  const byNumber = same.filter(i => words.includes(plain(i.number)))
  if (byNumber.length === 1) return { invoice: byNumber[0], possible: same }
  const byCustomer = same.filter(i => plain(i.bank_reference).length >= 3 && words.includes(plain(i.bank_reference)))
  if (!byNumber.length && byCustomer.length === 1) return { invoice: byCustomer[0], possible: same }
  const named = byNumber.length ? byNumber : byCustomer
  if (named.length > 1) return { possible: named, reason: `${named.length} open invoices of ${usd(line.amount_cents)} fit this deposit (${named.map(i => i.number).join(', ')}); choose the one it pays` }
  return { possible: same, reason: `Same amount as ${same.map(i => `${i.number} (${i.customer_name})`).join(', ')}, but the deposit names neither the invoice nor the customer's bank reference; confirm it` }
}

/** Match the given new lines where exactly one invoice fits; return what was matched and what waits for a person. */
export async function matchDeposits(db: D1Database, lineIds: string[]) {
  const matched: Data[] = [], needsPerson: Data[] = []
  if (!lineIds.length) return { matched, needsPerson }
  const lines = await all(db, `SELECT * FROM pt_bank_lines WHERE amount_cents > 0 AND id IN (${lineIds.map(() => '?').join(',')}) ORDER BY posted_date, id`, ...lineIds)
  for (const line of lines) {
    const verdict = judge(line, await openInvoices(db))
    if (!verdict.invoice) { if (verdict.reason) needsPerson.push({ lineId: line.id, description: line.description, amount: line.amount_cents, reason: verdict.reason }); continue }
    const inv = verdict.invoice, amount = (line.amount_cents / 100).toFixed(2)
    try {
      const plan = await matchPlan(db, pantry('auto-match'), {
        bankLineIds: [line.id], journalLineIds: [],
        create: [{ type: 'receipt', amount, contactId: inv.customer_id, date: line.posted_date, reference: line.reference || inv.number, memo: `Matched automatically to ${inv.number}`, allocations: [{ targetId: inv.id, amount }] }],
        note: `Matched automatically: ${usd(line.amount_cents)} from ${inv.customer_name} pays ${inv.number}`,
      }, { automatic: true })
      await run(db, plan.statements)
      matched.push({ lineId: line.id, matchId: plan.id, invoice: inv.number, customer: inv.customer_name, amount: line.amount_cents })
    } catch (error) {
      if (!(error instanceof Fault)) throw error
      needsPerson.push({ lineId: line.id, description: line.description, amount: line.amount_cents, reason: `Pantry could not match it to ${inv.number}: ${error.message}` })
    }
  }
  return { matched, needsPerson }
}

/** Payments recorded before their bank line arrived. A new line of exactly a recorded payment's amount, on its bank
 * account within a week of its date, that names its customer or vendor (or the payment's reference), clears that
 * payment's bank posting: nothing new is posted. Only a single such payment matches; anything else waits for a person. */
export async function matchRecorded(db: D1Database, lineIds: string[]) {
  const matched: Data[] = []
  if (!lineIds.length) return matched
  const lines = await all(db, `SELECT * FROM pt_bank_lines WHERE removed_at IS NULL AND id IN (${lineIds.map(() => '?').join(',')}) ORDER BY posted_date, id`, ...lineIds)
  for (const line of lines) {
    if (await one(db, 'SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1', line.id)) continue
    const candidates = await all(db, `SELECT p.id, p.direction, p.payment_date, p.reference, c.name, c.bank_reference, l.id AS journal_line_id
      FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id JOIN pt_bank_accounts b ON b.id = p.bank_account_id
      JOIN pt_journal_lines l ON l.entry_id = p.journal_id AND l.account_id = b.account_id
      WHERE p.bank_account_id = ? AND p.reversal_id IS NULL AND l.debit_cents - l.credit_cents = ?
        AND p.payment_date BETWEEN date(?, '-7 days') AND date(?, '+7 days')
        AND NOT EXISTS (SELECT 1 FROM pt_match_postings mp WHERE mp.journal_line_id = l.id AND mp.active = 1)`, line.bank_account_id, line.amount_cents, line.posted_date, line.posted_date)
    const words = plain(`${line.description} ${line.reference}`)
    const named = candidates.filter(p => [p.name, p.bank_reference, p.reference].some(t => plain(t ?? '').length >= 3 && words.includes(plain(t))))
    if (named.length !== 1) continue
    const p = named[0]
    try {
      const plan = await matchPlan(db, pantry('auto-match'), { bankLineIds: [line.id], journalLineIds: [p.journal_line_id], create: [],
        note: `Matched automatically: the ${usd(Math.abs(line.amount_cents))} payment ${p.direction === 'paid' ? 'to' : 'from'} ${p.name} recorded on ${p.payment_date}` }, { automatic: true })
      await run(db, plan.statements)
      matched.push({ lineId: line.id, matchId: plan.id, payment: p.id, contact: p.name, amount: line.amount_cents })
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
