// Deposits that match their invoice by themselves. When a bank line arrives
// (imported today, from a feed later) whose amount equals one open invoice's
// balance and whose text names that invoice or its customer's bank reference,
// Pantry records the receipt and matches it, marked "matched automatically"
// with an undo. Anything less certain is left for a person, with the reason.
import { pantry } from './access'
import { Fault, usd, type Data } from './core'
import { all, run } from './db'
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

/** For the reconciliation screen: why each unmatched deposit waits for a person. */
export async function depositNotes(db: D1Database, lines: Data[]) {
  const open = lines.filter(l => !l.match_id && l.amount_cents > 0)
  if (!open.length) return {}
  const invoices = await openInvoices(db), notes: Record<string, string> = {}
  for (const l of open) { const v = judge(l, invoices); if (v.reason) notes[l.id] = v.reason; else if (v.invoice) notes[l.id] = `Pays ${v.invoice.number} (${v.invoice.customer_name})` }
  return notes
}
