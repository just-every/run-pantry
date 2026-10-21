// CLOSE-004 rules that read what the business owes and pays: likely duplicate
// payments and amounts unusual for a vendor.
import { addDays, daysBetween, longDay, usd } from '../core'
import { all } from '../db'
import type { CheckSettings } from './settings'
import type { CitedLine, Finding } from './types'

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
const referenceKey = (reference: string) => reference.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The same day twelve months earlier (29 February falls back to the 28th). */
function yearBefore(day: string) {
  const [y, m, d] = day.split('-').map(Number), last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate()
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/**
 * Two bills, or two payments, to one vendor for the same amount within `duplicateDays`, or two bills carrying the
 * same vendor invoice number (case, spaces and punctuation ignored), unless one recurring template made both
 * (or, for payments, both pay bills that one template made). Only pairs whose later date is in the look-back window are judged.
 */
export async function duplicates(db: D1Database, today: string, s: CheckSettings): Promise<Finding[]> {
  const from = addDays(today, -s.lookbackDays)
  const template = new Map((await all(db, 'SELECT bill_id, recurring_id FROM pt_recurring_bill_runs WHERE bill_id IS NOT NULL')).map(r => [r.bill_id as string, r.recurring_id as string]))
  const bills = await all(db, `SELECT b.id, b.vendor_id, b.reference, b.bill_date, b.total_cents, c.name FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id
    WHERE b.status = 'posted' AND b.opening = 0 AND b.bill_date <= ? ORDER BY b.vendor_id, b.bill_date, b.id`, today)
  const cite = (b: Record<string, any>): CitedLine => ({ kind: 'bill', id: b.id, label: `${b.name} bill ${b.reference}`, date: b.bill_date, amountCents: b.total_cents })
  const found = new Map<string, { a: Record<string, any>; b: Record<string, any>; why: string }>()
  const byVendor = new Map<string, Record<string, any>[]>()
  for (const b of bills) byVendor.set(b.vendor_id, [...(byVendor.get(b.vendor_id) ?? []), b])
  for (const list of byVendor.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j]
    if (b.bill_date < from || (template.has(a.id) && template.get(a.id) === template.get(b.id))) continue
    const sameNumber = referenceKey(a.reference) !== '' && referenceKey(a.reference) === referenceKey(b.reference)
    const sameAmount = a.total_cents === b.total_cents && daysBetween(a.bill_date, b.bill_date) <= s.duplicateDays
    if (sameNumber || sameAmount) found.set(`bill:${a.id}:${b.id}`, { a, b, why: sameNumber ? `the same vendor invoice number (${a.reference} and ${b.reference})` : `the same amount ${usd(a.total_cents)} ${daysBetween(a.bill_date, b.bill_date)} days apart` })
  }
  const out: Finding[] = [...found].map(([subject, { a, b, why }]) => ({ rule: 'duplicate', subject, title: `Two bills from ${a.name} look like a duplicate`,
    detail: `${a.name} has bills ${a.reference} (${longDay(a.bill_date)}) and ${b.reference} (${longDay(b.bill_date)}) with ${why}.`,
    ruleText: 'Two bills to the same vendor for the same amount within the set number of days, or with the same vendor invoice number, unless one recurring template made both.', setting: { duplicateDays: s.duplicateDays }, lines: [cite(a), cite(b)] }))

  const covers = new Map<string, Set<string>>()
  for (const r of await all(db, `SELECT a.source_id AS payment_id, r.recurring_id FROM pt_allocations a JOIN pt_recurring_bill_runs r ON r.bill_id = a.target_id WHERE a.source_kind = 'payment' AND a.target_kind = 'bill'`))
    covers.set(r.payment_id, new Set([...(covers.get(r.payment_id) ?? []), r.recurring_id]))
  const pairs = await all(db, `SELECT p.id AS a_id, p.payment_date AS a_date, q.id AS b_id, q.payment_date AS b_date, p.amount_cents, p.reference AS a_ref, q.reference AS b_ref, c.name
    FROM pt_payments p JOIN pt_payments q ON q.contact_id = p.contact_id AND q.amount_cents = p.amount_cents AND q.direction = 'paid' AND q.reversal_id IS NULL AND (q.payment_date > p.payment_date OR (q.payment_date = p.payment_date AND q.id > p.id))
    JOIN pt_contacts c ON c.id = p.contact_id WHERE p.direction = 'paid' AND p.reversal_id IS NULL AND q.payment_date >= ? AND q.payment_date <= ? AND julianday(q.payment_date) - julianday(p.payment_date) <= ?
    ORDER BY p.payment_date, p.id, q.id`, from, today, s.duplicateDays)
  for (const p of pairs) {
    const shared = [...(covers.get(p.a_id) ?? [])].some(t => covers.get(p.b_id)?.has(t))
    if (shared) continue
    out.push({ rule: 'duplicate', subject: `payment:${p.a_id}:${p.b_id}`, title: `Two payments to ${p.name} look like a duplicate`,
      detail: `${p.name} was paid ${usd(p.amount_cents)} on ${longDay(p.a_date)} and again on ${longDay(p.b_date)}.`,
      ruleText: 'Two payments to the same vendor for the same amount within the set number of days, unless one recurring template made the bills they pay.', setting: { duplicateDays: s.duplicateDays },
      lines: [{ kind: 'payment', id: p.a_id, label: `Payment to ${p.name}${p.a_ref ? ` ${p.a_ref}` : ''}`, date: p.a_date, amountCents: p.amount_cents }, { kind: 'payment', id: p.b_id, label: `Payment to ${p.name}${p.b_ref ? ` ${p.b_ref}` : ''}`, date: p.b_date, amountCents: p.amount_cents }] })
  }
  return out
}

type Posting = { kind: 'bill' | 'entry'; id: string; vendorId: string; vendor: string; date: string; cents: number; label: string }

/**
 * A posted bill or expense (a posted entry not made by a bill, with an expense line naming the vendor) is judged against
 * the vendor's other postings dated in the twelve months before it. Only a vendor with at least `unusualMinPostings`
 * such postings is judged; the amount is flagged when it is more than `unusualRatio` times the median, or less than
 * 1/`unusualRatio` of it, and also differs from the median by at least `unusualMinDifferenceCents`.
 */
export async function unusualAmounts(db: D1Database, today: string, s: CheckSettings): Promise<Finding[]> {
  const bills = await all(db, `SELECT b.id, b.vendor_id, c.name, b.bill_date AS day, b.total_cents AS cents, b.reference FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id
    WHERE b.status = 'posted' AND b.opening = 0 AND b.bill_date <= ?`, today)
  const expenses = await all(db, `SELECT e.id, l.contact_id AS vendor_id, c.name, e.entry_date AS day, SUM(l.debit_cents - l.credit_cents) AS cents, e.memo, e.number
    FROM pt_journal_entries e JOIN pt_journal_lines l ON l.entry_id = e.id JOIN pt_accounts a ON a.id = l.account_id AND a.type = 'expense' JOIN pt_contacts c ON c.id = l.contact_id
    WHERE e.status = 'posted' AND e.source_kind NOT IN ('bill', 'reversal') AND e.reversed_by_id IS NULL AND e.reverses_id IS NULL AND e.entry_date <= ?
    GROUP BY e.id, l.contact_id HAVING SUM(l.debit_cents - l.credit_cents) > 0`, today)
  const postings: Posting[] = [
    ...bills.map(b => ({ kind: 'bill' as const, id: b.id, vendorId: b.vendor_id, vendor: b.name, date: b.day, cents: b.cents, label: `${b.name} bill ${b.reference}` })),
    ...expenses.map(e => ({ kind: 'entry' as const, id: e.id, vendorId: e.vendor_id, vendor: e.name, date: e.day, cents: e.cents, label: `${e.name} expense, journal entry ${e.number}: ${e.memo}` })),
  ]
  const byVendor = new Map<string, Posting[]>()
  for (const p of postings) byVendor.set(p.vendorId, [...(byVendor.get(p.vendorId) ?? []), p])
  const from = addDays(today, -s.lookbackDays), out: Finding[] = []
  for (const list of byVendor.values()) for (const p of list) {
    if (p.date < from) continue
    const earlier = list.filter(x => x.date < p.date && x.date >= yearBefore(p.date)).map(x => x.cents).sort((a, b) => a - b)
    if (earlier.length < s.unusualMinPostings) continue
    const mid = earlier.length >> 1, doubleMedian = earlier.length % 2 ? 2 * earlier[mid] : earlier[mid - 1] + earlier[mid]
    const high = 2 * p.cents > s.unusualRatio * doubleMedian, low = 2 * p.cents * s.unusualRatio < doubleMedian
    if (!(high || low) || Math.abs(2 * p.cents - doubleMedian) < 2 * s.unusualMinDifferenceCents) continue
    out.push({ rule: 'unusual-amount', subject: `${p.kind}:${p.id}`, title: `${usd(p.cents)} is unusual for ${p.vendor}`,
      detail: `${p.label} is ${usd(p.cents)}, ${high ? 'more than' : 'less than'} ${high ? `${s.unusualRatio} times` : `1/${s.unusualRatio} of`} the median ${usd(Math.round(doubleMedian / 2))} of ${plural(earlier.length, 'posting')} to ${p.vendor} in the 12 months before ${longDay(p.date)}, and at least ${usd(s.unusualMinDifferenceCents)} away from it.`,
      ruleText: 'An amount more than the set multiple of, or less than the same fraction of, the median of the vendor\'s postings in the previous 12 months, and also at least the set dollar amount away from the median; a vendor with fewer than the set number of postings is never judged.',
      setting: { unusualMinPostings: s.unusualMinPostings, unusualRatio: s.unusualRatio, unusualMinDifferenceCents: s.unusualMinDifferenceCents, lookbackDays: s.lookbackDays },
      lines: [{ kind: p.kind, id: p.id, label: p.label, date: p.date, amountCents: p.cents }], extra: { median2: doubleMedian, history: earlier.length } })
  }
  return out
}
