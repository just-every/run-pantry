// One read model for Activity and filtered review. History remains raw in the
// archive; parsed before/after and approval evidence are presentation fields.
import { addDays, date, optionalText, requireThat } from './core'
import { all } from './db'

export type ActivityFilter = { person?: string; from?: string; to?: string; record?: string; kind?: string }
export async function activity(db: D1Database, input: ActivityFilter = {}) {
  const person = optionalText(input.person, 'Person', 254).toLowerCase(), record = optionalText(input.record, 'Record', 200), kind = optionalText(input.kind, 'Record kind', 80)
  const from = input.from ? date(input.from, 'From date') : '', to = input.to ? date(input.to, 'To date') : ''
  requireThat(!from || !to || from <= to, 'The end date is on or after the start date')
  const where: string[] = [], params: unknown[] = []
  for (const [condition, value] of [['lower(actor_email) = ?', person], ['at >= ?', from && `${from}T00:00:00`], ['at < ?', to && `${addDays(to, 1)}T00:00:00`], ['subject_id = ?', record], ['subject_kind = ?', kind]]) {
    if (value) { where.push(condition); params.push(value) }
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [audit, approvals, people] = await Promise.all([
    all(db, `SELECT * FROM pt_audit ${clause} ORDER BY at DESC, rowid DESC LIMIT 300`, ...params),
    all(db, `SELECT * FROM pt_approvals ${clause} ORDER BY at DESC, rowid DESC LIMIT 300`, ...params),
    all(db, 'SELECT DISTINCT actor_email FROM pt_audit ORDER BY actor_email'),
  ])
  // An approval may concern a proposal/template, outside the selected record.
  const ids = [...new Set(audit.map(e => e.approval_id).filter(Boolean))]
  const relied = ids.length ? await all(db, `SELECT * FROM pt_approvals WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : []
  return { audit: audit.map(e => ({ ...e, approval: relied.find(a => a.id === e.approval_id) ?? null })), approvals, people: people.map(p => p.actor_email), filters: { person, from, to, record, kind } }
}
