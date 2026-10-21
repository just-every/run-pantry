// CLOSE-004 rules that read the books themselves: reconciliation age, the review
// queue, balances on the wrong side and suspense balances.
import { daysBetween, longDay, usd } from '../core'
import { all } from '../db'
import type { CheckSettings } from './settings'
import type { CitedLine, Finding } from './types'

const CITE_LIMIT = 25
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** An account whose last statements still have no reconciliation more than `unreconciledDays` after their end date. */
export async function unreconciled(db: D1Database, today: string, s: CheckSettings): Promise<Finding[]> {
  const rows = await all(db, `SELECT st.id, st.end_date, st.source_name, st.closing_cents, b.id AS bank_id, b.name FROM pt_statements st JOIN pt_bank_accounts b ON b.id = st.bank_account_id
    WHERE NOT EXISTS (SELECT 1 FROM pt_reconciliations r WHERE r.statement_id = st.id) ORDER BY b.name, st.end_date, st.id`)
  const by = new Map<string, { name: string; lines: CitedLine[] }>()
  for (const r of rows) {
    if (daysBetween(r.end_date, today) <= s.unreconciledDays) continue
    const entry = by.get(r.bank_id) ?? { name: r.name, lines: [] as CitedLine[] }
    entry.lines.push({ kind: 'statement', id: r.id, label: `${r.name} statement ending ${longDay(r.end_date)}`, date: r.end_date, amountCents: r.closing_cents })
    by.set(r.bank_id, entry)
  }
  return [...by].map(([id, { name, lines }]) => ({ rule: 'unreconciled', subject: id, title: `${name} is not reconciled`,
    detail: `${name} has ${plural(lines.length, 'statement')} with no reconciliation more than ${plural(s.unreconciledDays, 'day')} after the statement date; the oldest ends ${longDay(lines[0].date!)} (${daysBetween(lines[0].date!, today)} days ago).`,
    ruleText: 'No reconciliation more than the set number of days after a statement date.', setting: { unreconciledDays: s.unreconciledDays }, lines }))
}

/** Feed or statement lines waiting in the review queue (no active match, not removed by the bank) for more than `staleQueueDays`. */
export async function staleQueue(db: D1Database, today: string, s: CheckSettings): Promise<Finding[]> {
  const rows = await all(db, `SELECT l.id, l.bank_account_id, l.posted_date, l.amount_cents, l.description, b.name, substr(COALESCE(l.arrived_at, st.imported_at, l.posted_date), 1, 10) AS arrived
    FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id LEFT JOIN pt_statements st ON st.id = l.statement_id
    WHERE l.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines mb WHERE mb.bank_line_id = l.id AND mb.active = 1) ORDER BY b.name, l.posted_date, l.id`)
  const by = new Map<string, { name: string; lines: (CitedLine & { arrived: string })[] }>()
  for (const r of rows) {
    if (daysBetween(r.arrived, today) <= s.staleQueueDays) continue
    const entry = by.get(r.bank_account_id) ?? { name: r.name, lines: [] as (CitedLine & { arrived: string })[] }
    entry.lines.push({ kind: 'bank-line', id: r.id, label: `${r.description || 'Bank line'} · ${r.name}`, date: r.posted_date, amountCents: r.amount_cents, arrived: r.arrived })
    by.set(r.bank_account_id, entry)
  }
  return [...by].map(([id, { name, lines }]) => {
    const oldest = lines.reduce((a, l) => l.arrived < a.arrived ? l : a)
    return { rule: 'stale-queue', subject: id, title: `${plural(lines.length, 'line')} waiting in the review queue for ${name}`,
      detail: `${plural(lines.length, 'line')} for ${name} ${lines.length === 1 ? 'has' : 'have'} waited in the review queue more than ${plural(s.staleQueueDays, 'day')}; the oldest arrived ${longDay(oldest.arrived)}.`,
      ruleText: 'A line waiting in the review queue for more than the set number of days.', setting: { staleQueueDays: s.staleQueueDays },
      lines: lines.slice(0, CITE_LIMIT).map(({ arrived: _a, ...line }) => line), extra: { total: lines.length, ids: lines.map(l => l.id) } }
  })
}

async function recentLines(db: D1Database, accountId: string, today: string, limit = 10): Promise<CitedLine[]> {
  const rows = await all(db, `SELECT e.id, e.number, e.entry_date, e.memo, l.debit_cents - l.credit_cents AS net FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ? AND e.status = 'posted' AND e.entry_date <= ? ORDER BY e.entry_date DESC, e.number DESC, l.id DESC LIMIT ?`, accountId, today, limit)
  return rows.map(r => ({ kind: 'entry' as const, id: r.id, label: `Journal entry ${r.number}: ${r.memo}`, date: r.entry_date, amountCents: r.net }))
}

/** A credit balance in receivables, or a debit balance in a card or line-of-credit account, as of today. */
export async function wrongSide(db: D1Database, today: string, s: CheckSettings): Promise<Finding[]> {
  const rows = await all(db, `SELECT a.id, a.code, a.name, a.subtype, SUM(l.debit_cents - l.credit_cents) AS net, COUNT(*) AS n FROM pt_accounts a JOIN pt_journal_lines l ON l.account_id = a.id JOIN pt_journal_entries e ON e.id = l.entry_id
    WHERE e.status = 'posted' AND e.entry_date <= ? AND a.active = 1 AND (a.subtype = 'receivable' OR (a.type = 'liability' AND a.subtype = 'bank')) GROUP BY a.id ORDER BY a.code`, today)
  const out: Finding[] = []
  for (const r of rows) {
    const receivable = r.subtype === 'receivable'
    if (receivable ? r.net >= 0 : r.net <= 0) continue
    out.push({ rule: 'wrong-side', subject: r.id, title: `${r.code} ${r.name} has a ${receivable ? 'credit' : 'debit'} balance`,
      detail: `${r.name} (${r.code}) is ${usd(Math.abs(r.net))} ${receivable ? 'credit' : 'debit'}; ${receivable ? 'receivables should not run a credit balance' : 'a card or line of credit should not run a debit balance'}. The most recent postings are listed.`,
      ruleText: receivable ? 'A credit balance in receivables.' : 'A debit balance in a card or line-of-credit account.', setting: {},
      lines: [{ kind: 'account', id: r.id, label: `${r.code} ${r.name}`, amountCents: r.net }, ...await recentLines(db, r.id, today)], extra: { balance: r.net, postings: r.n } })
  }
  return out
}

/** A balance that has stood nonzero for more than `suspenseDays` in an account marked suspense or "ask my accountant". */
export async function suspense(db: D1Database, today: string, s: CheckSettings): Promise<Finding[]> {
  const out: Finding[] = []
  for (const a of await all(db, 'SELECT id, code, name FROM pt_accounts WHERE suspense = 1 AND active = 1 ORDER BY code')) {
    const postings = await all(db, `SELECT e.id, e.number, e.entry_date, e.memo, l.debit_cents - l.credit_cents AS net FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
      WHERE l.account_id = ? AND e.status = 'posted' AND e.entry_date <= ? ORDER BY e.entry_date, e.number, l.id`, a.id, today)
    // Walk the days: the balance stands from the first day it left zero (after that day's postings) and has not been zero since.
    let balance = 0, since: string | null = null
    for (let i = 0; i < postings.length; i++) {
      balance += postings[i].net
      if (i + 1 < postings.length && postings[i + 1].entry_date === postings[i].entry_date) continue
      if (balance === 0) since = null
      else if (since === null) since = postings[i].entry_date
    }
    if (balance === 0 || since === null || daysBetween(since, today) <= s.suspenseDays) continue
    out.push({ rule: 'suspense', subject: a.id, title: `${usd(Math.abs(balance))} stands in ${a.name}`,
      detail: `${a.name} (${a.code}) has held a ${balance > 0 ? 'debit' : 'credit'} balance of ${usd(Math.abs(balance))} since ${longDay(since)}, more than ${plural(s.suspenseDays, 'day')}; move it to its real account or ask the accountant.`,
      ruleText: 'A balance older than the set number of days in an account marked suspense or "ask my accountant".', setting: { suspenseDays: s.suspenseDays },
      lines: [{ kind: 'account', id: a.id, label: `${a.code} ${a.name}`, amountCents: balance }, ...postings.filter(p => p.entry_date >= since!).slice(-CITE_LIMIT).map(p => ({ kind: 'entry' as const, id: p.id, label: `Journal entry ${p.number}: ${p.memo}`, date: p.entry_date, amountCents: p.net }))],
      extra: { balance, since } })
  }
  return out
}
