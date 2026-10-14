// D1 access: every write is one atomic batch. Conditions that must still hold
// when the batch commits (current authority, unchanged revisions, open periods)
// go in as guard rows; one false guard rolls the whole batch back.
import { Fault, uid, now, type Data } from './core'

export type Sql = { sql: string; params: unknown[] }
export const q = (sql: string, ...params: unknown[]): Sql => ({ sql, params })

export const guard = (condition: string, ...params: unknown[]): Sql =>
  q(`INSERT INTO pt_guard SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END`, ...params)

/** The statement just before this one changed exactly `n` rows. */
export const changed = (n = 1) => q(`INSERT INTO pt_guard SELECT CASE WHEN changes() = ${n} THEN 1 ELSE 0 END`)

export function faultFrom(error: unknown): Fault | null {
  const message = String((error as Error)?.message ?? error)
  if (message.includes('PANTRY_PERIOD_LOCKED')) return new Fault(409, 'That date is in a locked period; ask for the period to be reopened first')
  if (message.includes('PANTRY_UNBALANCED')) return new Fault(400, 'Entry does not balance: debits must equal credits')
  if (message.includes('PANTRY_POSTED_IMMUTABLE')) return new Fault(409, 'Posted entries cannot change; reverse the entry to correct it')
  if (message.includes('CHECK constraint failed: ok = 1')) return new Fault(409, 'The books or your access changed while you worked; reload and try again')
  if (message.includes('pt_match_bank_line_once') || message.includes('pt_match_bank_lines.bank_line_id')) return new Fault(409, 'A statement line is already matched')
  if (message.includes('pt_match_posting_once') || message.includes('pt_match_postings.journal_line_id')) return new Fault(409, 'A ledger posting is already matched')
  if (message.includes('UNIQUE constraint failed')) return new Fault(409, 'That record already exists: ' + message.replace(/.*UNIQUE constraint failed: /, '').split(':')[0])
  if (message.includes('FOREIGN KEY constraint failed')) return new Fault(409, 'Another record still refers to this one')
  return null
}

export async function run(db: D1Database, statements: Sql[]) {
  try {
    return await db.batch([...statements, q('DELETE FROM pt_guard')].map(s => db.prepare(s.sql).bind(...s.params)))
  } catch (error) {
    throw faultFrom(error) ?? error
  }
}

export async function all<T = Data>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results
}

export async function one<T = Data>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return await db.prepare(sql).bind(...params).first<T>()
}

export type AuditActor = { email: string; kind: 'person' | 'agent' }

export const audit = (actor: AuditActor, action: string, subjectKind: string, subjectId: string, detail: Data = {}) =>
  q('INSERT INTO pt_audit (id, at, actor_email, actor_kind, action, subject_kind, subject_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    uid(), now(), actor.email, actor.kind, action, subjectKind, subjectId, JSON.stringify(detail))

export const approval = (actor: AuditActor, subjectKind: string, subjectId: string, subjectRevision: string, action: string, decision: 'approved' | 'rejected', note = '') =>
  q('INSERT INTO pt_approvals (id, subject_kind, subject_id, subject_revision, action, decision, actor_email, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    uid(), subjectKind, subjectId, subjectRevision, action, decision, actor.email, note, now())

/** Writes may not land in a locked period; the triggers repeat this for postings. */
export const periodOpen = (day: string) => guard("NOT EXISTS (SELECT 1 FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date)", day)

export async function assertOpen(db: D1Database, day: string) {
  const locked = await one(db, "SELECT id FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", day)
  if (locked) throw new Fault(409, `${day} is in ${locked.id}, which is locked; ask for the period to be reopened first`)
}
