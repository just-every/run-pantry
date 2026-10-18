// Questions as stored: the question, its answers, its thread, and the agent's
// own settings. The agent acts in the audit trail as "agent:pantry".
import { Fault, now, requireThat, uid, type Data } from '../core'
import { all, one, q, type AuditActor, type Sql } from '../db'
import type { Choice } from './checks'

export const AGENT: AuditActor = { email: 'agent:pantry', kind: 'agent' }
export const OPEN = ['open', 'confirm']

export type Question = { [field: string]: any; id: string; kind: string; status: string; revision: string; choices: Choice[]; facts: Data; pending: Data | null }

export async function question(db: D1Database, id: string): Promise<Question> {
  const row = await one(db, 'SELECT * FROM pt_questions WHERE id = ?', id)
  if (!row) throw new Fault(404, 'Question not found')
  return parse(row)
}

export const parse = (row: Data): Question => ({ ...row, choices: JSON.parse(row.choices), facts: JSON.parse(row.facts), pending: row.pending ? JSON.parse(row.pending) : null }) as Question

export async function thread(db: D1Database, ids: string[]) {
  const out = new Map<string, Data[]>()
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    for (const m of await all(db, `SELECT * FROM pt_question_messages WHERE question_id IN (${chunk.map(() => '?').join(',')}) ORDER BY at, rowid`, ...chunk))
      out.set(m.question_id, [...(out.get(m.question_id) ?? []), m])
  }
  return out
}

const RECORD_LINK: Record<string, (id: string) => string> = {
  'bank-line': () => '/app/bank',
  bill: id => `/app/reports?record=bill:${id}`,
  journal: id => `/app/reports?record=entry:${id}`,
  entry: id => `/app/reports?record=entry:${id}`,
  invoice: id => `/app/reports?record=invoice:${id}`,
  'report-line': id => { const p = new URLSearchParams(JSON.parse(id)); return `/app/reports?${p}` },
  payment: id => `/app/reports?record=payment:${id}`,
  statement: id => `/app/bank?statement=${id}`,
}

/** Questions with their threads and where their record opens. */
export async function withThreads(db: D1Database, rows: Question[]) {
  const threads = await thread(db, rows.map(r => r.id))
  return rows.map(r => ({ ...r, messages: threads.get(r.id) ?? [], recordLink: RECORD_LINK[r.subject_kind]?.(r.subject_id) ?? null }) as Question)
}

/** One line of the thread. */
export const say = (questionId: string, author: string, via: 'agent' | 'app' | 'email', body: string): Sql =>
  q('INSERT INTO pt_question_messages (id, question_id, at, author, via, body) VALUES (?, ?, ?, ?, ?, ?)', uid(), questionId, now(), author, via, body.slice(0, 4000))

export type AgentSettings = { email_on: number; per_day: number; deposit_days: number; file_days: number; receipt_cents: number; last_run_at: string | null; last_run: Data; revision: string; updated_by: string | null; updated_at: string | null }

export async function agentSettings(db: D1Database): Promise<AgentSettings> {
  const row = await one(db, 'SELECT * FROM pt_books_agent WHERE id = 1')
  requireThat(row, 'The books agent is not set up; run the database migrations', 500)
  return { ...row, last_run: JSON.parse(row.last_run || '{}') } as AgentSettings
}

/** A short reference for the email subject; replies carry it back. */
export function newRef() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), b => ALPHABET[b % ALPHABET.length]).join('')
}
