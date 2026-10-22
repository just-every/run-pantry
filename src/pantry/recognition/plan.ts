import { dimensionTags, dimensionValues } from '../dimensions'
import { addDays, cents, date, list, requireThat, text, uid, type Data } from '../core'
import { all, guard, one, type Sql } from '../db'
import { parseLines, type Line } from '../journal'

export type Installment = { id: string; date: string; amount_cents: number; label: string; phase: 'recognize' | 'accrue' | 'reverse'; milestone?: boolean; origin_id?: string }
export type Schedule = Data & { plan: Installment[] }

export async function schedule(db: D1Database, id: string): Promise<Schedule> {
  const row = await one(db, 'SELECT * FROM pt_recognition_schedules WHERE id = ?', id)
  requireThat(row, 'Recognition schedule not found', 404)
  return { ...row, plan: JSON.parse(row.plan) }
}

/** Every date is computed from the original anchor; month-end remains month-end. */
function monthly(start: string, n: number, end = false) {
  const [y, m, d] = start.split('-').map(Number)
  const first = new Date(start + 'T00:00:00Z')
  first.setUTCDate(1)
  first.setUTCMonth(m - 1 + n)
  const last = new Date(first)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  const anchorLast = new Date(start + 'T00:00:00Z')
  anchorLast.setUTCMonth(m, 0)
  first.setUTCDate(end || d === anchorLast.getUTCDate() ? last.getUTCDate() : Math.min(d, last.getUTCDate()))
  requireThat(first.getUTCFullYear() >= y && first.getUTCFullYear() <= 9999, 'Schedule must end by year 9999')
  return first.toISOString().slice(0, 10)
}

export const snapshot = (s: Schedule) => JSON.stringify({ revision: s.revision, kind: s.kind, name: s.name, balance_account_id: s.balance_account_id,
  recognition_account_id: s.recognition_account_id, amount_cents: s.amount_cents, start_date: s.start_date, months: s.months,
  source_journal_id: s.source_journal_id, source_line_id: s.source_line_id, source_date: s.source_date, ...(dimensionValues(s).some(Boolean)?{dimensions:dimensionTags(s)}:{}), plan: s.plan, prepared_by: s.prepared_by })

export function linesFor(s: Schedule, p: Installment): Line[] {
  const positiveBalance = s.kind === 'deferred' || p.phase === 'reverse'
  return [
    { ...dimensionTags(s),accountId: s.balance_account_id, debit: positiveBalance ? p.amount_cents : 0, credit: positiveBalance ? 0 : p.amount_cents },
    { ...dimensionTags(s),accountId: s.recognition_account_id, debit: positiveBalance ? 0 : p.amount_cents, credit: positiveBalance ? p.amount_cents : 0 },
  ]
}
export const inputLines = (lines: Line[]) => lines.map(l => ({ ...l, debit: (l.debit / 100).toFixed(2), credit: (l.credit / 100).toFixed(2) }))

export function sourceFence(s: Schedule): Sql[] {
  if (s.kind === 'accrual') return []
  return [guard(`EXISTS (SELECT 1 FROM pt_journal_lines l JOIN pt_journal_entries j ON j.id = l.entry_id
    WHERE l.id = ? AND j.id = ? AND j.status = 'posted' AND j.reversed_by_id IS NULL AND j.entry_date = ?
    AND l.account_id = ? AND l.debit_cents = ? AND l.credit_cents = ?)`, s.source_line_id, s.source_journal_id, s.source_date,
    s.balance_account_id, s.kind === 'prepaid' ? s.amount_cents : 0, s.kind === 'deferred' ? s.amount_cents : 0)]
}

export async function validateAccounts(db: D1Database, s: Schedule) {
  const accounts = await all(db, 'SELECT * FROM pt_accounts WHERE id IN (?, ?)', s.balance_account_id, s.recognition_account_id)
  const balance = accounts.find(a => a.id === s.balance_account_id), recognition = accounts.find(a => a.id === s.recognition_account_id)
  requireThat(balance?.type === (s.kind === 'prepaid' ? 'asset' : 'liability'), 'Choose an asset account for prepaids or liability account for accruals and deferred revenue')
  requireThat(recognition?.type === (s.kind === 'deferred' ? 'income' : 'expense'), 'Choose an expense account, or income account for deferred revenue')
  await parseLines(db, inputLines(linesFor(s, s.plan[0])))
}
export const accountFences = (s: Schedule) => [
  guard("EXISTS (SELECT 1 FROM pt_accounts WHERE id = ? AND active = 1 AND type = ? AND subtype NOT IN ('receivable', 'payable'))", s.balance_account_id, s.kind === 'prepaid' ? 'asset' : 'liability'),
  guard("EXISTS (SELECT 1 FROM pt_accounts WHERE id = ? AND active = 1 AND type = ? AND subtype NOT IN ('receivable', 'payable'))", s.recognition_account_id, s.kind === 'deferred' ? 'income' : 'expense'),
]

export async function parsePlan(db: D1Database, b: Data): Promise<Schedule> {
  const kind = text(b.kind, 'Schedule kind')
  requireThat(['prepaid', 'accrual', 'deferred'].includes(kind), 'Choose prepaid, accrual or deferred')
  const amount = cents(b.amount, 'Schedule amount'), start = date(b.startDate, 'Start date')
  let months: number | null = null, plan: Installment[]
  if (b.milestones !== undefined) {
    requireThat(kind === 'deferred' && b.months === undefined, 'Milestones are for deferred revenue; choose months or milestones')
    plan = list<Data>(b.milestones, 'Milestones', 200).map(m => ({ id: m.id ? text(m.id, 'Milestone ID', 100) : uid(), date: date(m.date, 'Milestone date'), amount_cents: cents(m.amount, 'Milestone amount'), label: text(m.label, 'Milestone label', 200), phase: 'recognize', milestone: true }))
    requireThat(plan.length > 0 && plan.every(p => p.date >= start), 'Add milestones on or after the start date')
    requireThat(new Set(plan.map(p => p.id)).size === plan.length, 'Milestone IDs must be unique')
    requireThat(plan.reduce((n, p) => n + p.amount_cents, 0) === amount, 'Milestone amounts must total the funded schedule amount')
    plan.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  } else {
    months = Number(b.months ?? (kind === 'accrual' ? 1 : NaN))
    requireThat(Number.isSafeInteger(months) && months >= 1 && months <= 1200, 'Schedule length is 1–1200 months')
    requireThat(kind === 'accrual' || amount >= months, 'Each monthly installment must be at least one cent')
    const part = kind === 'accrual' ? amount : Math.floor(amount / months)
    plan = []
    for (let n = 0; n < months; n++) {
      const day = monthly(start, n, kind === 'accrual'), value = kind === 'accrual' || n < months - 1 ? part : amount - part * (months - 1)
      plan.push({ id: day, date: day, amount_cents: value, label: kind === 'accrual' ? 'Month-end accrual' : `Month ${n + 1}`, phase: kind === 'accrual' ? 'accrue' : 'recognize' })
      if (kind === 'accrual') {
        const reverse = addDays(day, 1)
        requireThat(/^\d{4}-/.test(reverse), 'Accrual reversal must be through year 9999')
        plan.push({ id: reverse, date: reverse, amount_cents: value, label: 'Next-day reversal', phase: 'reverse', origin_id: day })
      }
    }
  }
  const s: Schedule = { ...Object.fromEntries(['class','location','project'].map(k=>[k+'_name',dimensionTags(b)[(k+'Name') as 'className']])),kind, name: text(b.name, 'Schedule name', 200), balance_account_id: text(b.balanceAccountId, 'Balance-sheet account'), recognition_account_id: text(b.recognitionAccountId, 'Recognition account'), amount_cents: amount, start_date: start, months, plan, source_journal_id: null, source_line_id: null, source_date: null }
  if (kind !== 'accrual') {
    const source = text(b.sourceJournalId, 'Posted funding journal')
    const rows = await all(db, `SELECT l.*, j.entry_date FROM pt_journal_lines l JOIN pt_journal_entries j ON j.id = l.entry_id
      WHERE j.id = ? AND j.status = 'posted' AND j.reversed_by_id IS NULL AND l.account_id = ? AND l.debit_cents = ? AND l.credit_cents = ?`, source, s.balance_account_id, kind === 'prepaid' ? amount : 0, kind === 'deferred' ? amount : 0)
    requireThat(rows.length === 1, 'The posted funding journal must have one matching balance-sheet line for this exact amount')
    requireThat(rows[0].entry_date <= start, 'Funding must be posted on or before the schedule start')
    const allocation = await one(db, 'SELECT id FROM pt_recognition_schedules WHERE source_line_id = ?', rows[0].id)
    requireThat(!allocation || allocation.id === b.id, 'That funding line is already allocated to another recognition schedule', 409)
    if(!dimensionValues(b).some(Boolean))Object.assign(s,{class_name:rows[0].class_name,location_name:rows[0].location_name,project_name:rows[0].project_name})
    Object.assign(s, { source_journal_id: source, source_line_id: rows[0].id, source_date: rows[0].entry_date })
  } else requireThat(!b.sourceJournalId, 'Accruals create their own origin and reversal; do not select a funding journal')
  await validateAccounts(db,s)
  return s
}
