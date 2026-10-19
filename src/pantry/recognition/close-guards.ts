import { requireThat } from '../core'
import { guard, one, type Sql } from '../db'
import { recognitionTies } from './view'

// Capture the complete recognition authority and execution state before reading
// ties. Even a new schedule on an otherwise untracked account invalidates close.
const fingerprint = `json_object(
 'schedules', (SELECT json_group_array(json_object('id', id, 'revision', revision, 'kind', kind, 'name', name,
   'balance', balance_account_id, 'recognition', recognition_account_id, 'amount', amount_cents,
   'start', start_date, 'months', months, 'plan', plan, 'source', source_journal_id, 'line', source_line_id,
   'source_date', source_date, 'status', status, 'preparer', prepared_by, 'approver', approved_by,
   'approval_revision', approved_revision, 'approval_snapshot', approved_snapshot, 'updated_at', updated_at))
   FROM (SELECT * FROM pt_recognition_schedules ORDER BY id)),
 'runs', (SELECT json_group_array(json_object('schedule', schedule_id, 'revision', revision, 'occurrence', occurrence,
   'scheduled', scheduled_date, 'date', entry_date, 'snapshot', snapshot, 'journal', journal_id,
   'status', status, 'detail', detail, 'at', at)) FROM (SELECT * FROM pt_recognition_runs ORDER BY schedule_id, revision, occurrence)),
 'milestones', (SELECT json_group_array(json_object('schedule', schedule_id, 'revision', revision, 'occurrence', occurrence,
   'date', achieved_date, 'by', recorded_by, 'at', recorded_at)) FROM (SELECT * FROM pt_recognition_milestones ORDER BY schedule_id, revision, occurrence)))`

export async function recognitionCloseGuards(db: D1Database, asOf: string): Promise<Sql[]> {
  const original = await one<{ state: string }>(db, `SELECT ${fingerprint} AS state`)
  const ties = await recognitionTies(db, asOf)
  requireThat(ties.every(t => t.ties), 'Recognition schedules do not tie: resolve missing occurrences and balance differences before locking', 409)
  return [guard(`${fingerprint} = ?`, original!.state), ...ties.map(t => guard(`(
    SELECT COALESCE(SUM((l.debit_cents - l.credit_cents) * ?), 0) FROM pt_journal_lines l
    JOIN pt_journal_entries j ON j.id = l.entry_id WHERE l.account_id = ? AND j.status = 'posted' AND j.entry_date <= ?
  ) = ?`, t.account_type === 'asset' ? 1 : -1, t.account_id, asOf, t.actual_cents))]
}
