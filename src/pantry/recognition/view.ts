import { businessDay, sendingSettings } from '../delivery'
import { date, type Data } from '../core'
import { all } from '../db'
import type { Installment, Schedule } from './plan'

/** Expected balances follow the approved plan's dates, not successful execution;
 * a missing due posting therefore cannot make a broken tie look balanced. */
async function recognitionState(db: D1Database, asOf: string) {
  date(asOf, 'As of')
  const [rows, runs, milestones, balances, fundingSources] = await Promise.all([
    all(db, 'SELECT * FROM pt_recognition_schedules ORDER BY name, id'),
    all(db, `SELECT r.*, j.number AS journal_number, j.reversed_by_id, rv.entry_date AS reversed_date
      FROM pt_recognition_runs r LEFT JOIN pt_journal_entries j ON j.id = r.journal_id
      LEFT JOIN pt_journal_entries rv ON rv.id = j.reversed_by_id ORDER BY r.entry_date, r.at`),
    all(db, 'SELECT * FROM pt_recognition_milestones'),
    all(db, `SELECT a.id AS account_id, a.code AS account_code, a.name AS account_name, a.type AS account_type,
      j.id AS journal_id, j.reverses_id, j.entry_date, l.debit_cents, l.credit_cents FROM pt_accounts a
      LEFT JOIN pt_journal_lines l ON l.account_id = a.id LEFT JOIN pt_journal_entries j ON j.id = l.entry_id AND j.status = 'posted'
      WHERE a.id IN (SELECT balance_account_id FROM pt_recognition_schedules)`),
    all(db, `SELECT j.id AS journal_id, j.number AS journal_number, j.entry_date, j.memo, l.id AS line_id, l.account_id,
      a.name AS account_name, a.type AS account_type, l.debit_cents, l.credit_cents, s.id AS allocated_schedule_id
      FROM pt_journal_entries j JOIN pt_journal_lines l ON l.entry_id = j.id JOIN pt_accounts a ON a.id = l.account_id
      LEFT JOIN pt_recognition_schedules s ON s.source_line_id = l.id
      WHERE j.status = 'posted' AND j.reversed_by_id IS NULL AND a.active = 1 AND a.subtype NOT IN ('receivable', 'payable')
      AND ((a.type = 'asset' AND l.debit_cents > 0 AND l.credit_cents = 0) OR (a.type = 'liability' AND l.credit_cents > 0 AND l.debit_cents = 0))
      ORDER BY j.entry_date DESC, j.number DESC, l.line_no`),
  ])
  const exceptions: Data[] = [], schedules: Schedule[] = []
  for (const row of rows) {
    const s: Schedule = { ...row, plan: JSON.parse(row.plan) }
    const currentRuns = runs.filter(r => r.schedule_id === s.id && r.revision === s.revision)
    const achievement = milestones.filter(m => m.schedule_id === s.id && m.revision === s.revision)
    const exception = (p: Installment, status: string, detail: string, day = p.date) => {
      const x = { schedule_id: s.id, name: s.name, occurrence: p.id, revision: s.revision, status, detail, date: day }
      exceptions.push(x)
      return x
    }
    let expected = s.kind === 'accrual' || s.source_date > asOf ? 0 : s.amount_cents
    s.occurrences = s.plan.map(p => {
      const r = currentRuns.find(r => r.occurrence === p.id), m = achievement.find(m => m.occurrence === p.id)
      const achieved = m && m.achieved_date <= asOf ? m.achieved_date : null
      const effectiveDate = p.milestone ? achieved : p.date
      if (effectiveDate && effectiveDate <= asOf) expected += (p.phase === 'accrue' ? 1 : -1) * p.amount_cents
      let status = r && r.entry_date <= asOf ? r.status : 'pending', detail = r?.detail ?? ''
      if (status === 'posted' && r && r.reversed_by_id && r.reversed_date <= asOf) {
        const ownReversal = currentRuns.find(v => v.journal_id === r.reversed_by_id && s.plan.some(p => p.id === v.occurrence && p.phase === 'reverse' && p.origin_id === r.occurrence))
        if (!ownReversal) exception(p, 'reversed', 'This schedule posting was reversed outside its planned accrual reversal', r.reversed_date)
      }
      if (r && (status === 'failed' || status === 'blocked')) exception(p, status, detail, r.entry_date)
      else if (status !== 'posted') {
        if (p.milestone && !achieved) {
          status = 'awaiting-milestone'
          detail = 'A person must explicitly record achievement before this milestone posts'
          if (p.date <= asOf) exception(p, status, detail)
        } else if (effectiveDate && effectiveDate <= asOf) {
          status = 'missed'
          detail = s.status === 'awaiting-approval' ? 'Waiting for approval of this exact schedule revision' : 'Due occurrence has not posted; the next scheduled check catches up'
          exception(p, status, detail, effectiveDate)
        }
      }
      return { ...p, ...(r ?? {}), id: p.id, date: p.date, status, detail, achieved_date: achieved, recorded_by: m?.recorded_by ?? null }
    })
    s.remaining_cents = expected
    const ids = new Set(runs.filter(r => r.schedule_id === s.id).map(r => r.journal_id).filter(Boolean))
    const sign = s.kind === 'prepaid' ? 1 : -1
    const sourceReversed = balances.some(l => l.reverses_id === s.source_journal_id && l.entry_date && l.entry_date <= asOf)
    const funding = s.kind !== 'accrual' && s.source_date <= asOf && !sourceReversed ? s.amount_cents : 0
    s.posted_remaining_cents = funding + balances.filter(l => l.account_id === s.balance_account_id && l.entry_date && l.entry_date <= asOf && (ids.has(l.journal_id) || ids.has(l.reverses_id)))
      .reduce((n, l) => n + sign * (l.debit_cents - l.credit_cents), 0)
    s.runs_list = runs.filter(r => r.schedule_id === s.id)
    s.editable = !s.runs_list.some((r: Data) => r.status === 'posted')
    s.recognized_cents = s.kind === 'accrual' ? null : (s.source_date <= asOf ? s.amount_cents : 0) - s.remaining_cents
    schedules.push(s)
  }
  const ties = [...new Set(schedules.map(s => s.balance_account_id))].map(id => {
    const lines = balances.filter(l => l.account_id === id), account = lines[0]
    const expected = schedules.filter(s => s.balance_account_id === id).reduce((n, s) => n + s.remaining_cents, 0)
    const actual = lines.filter(l => l.entry_date && l.entry_date <= asOf).reduce((n, l) => n + (account.account_type === 'asset' ? 1 : -1) * (l.debit_cents - l.credit_cents), 0)
    const ids = new Set(schedules.filter(s => s.balance_account_id === id).map(s => s.id))
    const issues = exceptions.filter(e => ids.has(e.schedule_id))
    return { account_id: id, account_code: account.account_code, account_name: account.account_name, account_type: account.account_type,
      expected_cents: expected, actual_cents: actual, difference_cents: actual - expected, ties: actual === expected && issues.length === 0,
      exceptions: issues, schedules: schedules.filter(s => ids.has(s.id)).map(s => ({ id: s.id, name: s.name, remaining_cents: s.remaining_cents })) }
  })
  exceptions.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
  return { asOf, schedules, exceptions, ties, fundingSources }
}

export async function recognitionView(db: D1Database, asOf: string) {
  return { ...await recognitionState(db, asOf), today: businessDay((await sendingSettings(db)).time_zone) }
}
export async function recognitionTies(db: D1Database, asOf: string) { return (await recognitionState(db, asOf)).ties }
