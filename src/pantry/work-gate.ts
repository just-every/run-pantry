// Due work that scans the books runs when the day has turned, or when something was recorded since
// its last run (and, for a run an ordinary request starts, REQUEST_GAP_MS have passed); never
// otherwise. The audit log is append-only and every recorded change adds a row (a bank feed's new
// lines add rows to pt_bank_lines instead), so the last rowid of the two says whether anything could
// have changed. A run that finds nothing new reads a handful of rows however much history the books
// hold; a busy ledger is rescanned at most once per Cron tick, or about twice an hour when requests
// start it. What a run writes itself is not a change for it. Claiming also keeps overlapping runs apart.
import { now } from './core'

/** An ordinary request rechecks a changed ledger no more often than this; Cron's half-hourly tick has no gap of its own. */
export const REQUEST_GAP_MS = 25 * 60 * 1000

const POSITION = "(SELECT COALESCE(MAX(rowid), 0) FROM pt_audit) || ':' || (SELECT COALESCE(MAX(rowid), 0) FROM pt_bank_lines)"

/** Run `work` when `day` is new, or the books have grown since `job` last ran and `gapMs` have passed, and return what it returned; null when it did not run. A failed run is released to try again. */
export async function whenChanged<T>(db: D1Database, job: string, day: string, work: () => Promise<T>, gapMs = 0): Promise<T | null> {
  const claim = await db.prepare(`INSERT INTO pt_work_gate (job, day, epoch, ran_at) SELECT ?, ?, ${POSITION}, ? WHERE true
    ON CONFLICT(job) DO UPDATE SET day = excluded.day, epoch = excluded.epoch, ran_at = excluded.ran_at
    WHERE pt_work_gate.day <> excluded.day OR (pt_work_gate.epoch <> excluded.epoch AND pt_work_gate.ran_at <= ?)`)
    .bind(job, day, now(), new Date(Date.now() - gapMs).toISOString()).run()
  if (claim.meta.changes !== 1) return null
  try {
    const result = await work()
    await db.prepare(`UPDATE pt_work_gate SET epoch = ${POSITION} WHERE job = ?`).bind(job).run()
    return result
  } catch (error) {
    await db.prepare('DELETE FROM pt_work_gate WHERE job = ?').bind(job).run()
    throw error
  }
}

export const utcDay = () => now().slice(0, 10)
