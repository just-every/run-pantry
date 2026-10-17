// The month's questions at close: one thread, oldest first, and for each one
// still open, why it is still open.
import { longDay } from '../core'
import { all } from '../db'
import { parse, withThreads, type Question } from './store'

export async function periodThread(db: D1Database, period: string) {
  return withThreads(db, (await all(db, 'SELECT * FROM pt_questions WHERE period = ? ORDER BY record_date, asked_at, id', period)).map(parse))
}

/** "3 still open: 2 emailed with no answer yet, 1 waits for your yes." */
export function openSummary(open: Question[]) {
  const groups = new Map<string, number>()
  for (const q of open) {
    const why = q.status === 'confirm' ? 'waiting for your yes' : q.email_status === 'sent' ? 'emailed with no answer yet' : 'asked in Pantry with no answer yet'
    groups.set(why, (groups.get(why) ?? 0) + 1)
  }
  return `${open.length} still open: ${[...groups].map(([why, n]) => `${n} ${why}`).join(', ')}`
}

/** Why a question is still open, in a few words. */
export function openReason(q: Question) {
  if (q.status === 'confirm') return 'your answer waits for your yes'
  const asked = longDay(String(q.asked_at).slice(0, 10))
  if (q.email_status === 'sent') return `emailed ${longDay(String(q.emailed_at).slice(0, 10))}, no answer yet`
  if (q.email_status === 'held') return `asked ${asked}; waiting to be emailed`
  return `asked ${asked} in Pantry, no answer yet`
}
