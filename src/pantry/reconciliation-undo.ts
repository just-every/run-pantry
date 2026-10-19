// Undo a confirmed, newest-first chain without changing any ledger posting.
import { authority, who } from './access'
import { now, requireThat, text, uid, type Data } from './core'
import { all, audit, changed, guard, one, q, run } from './db'
import type { Command } from './context'

export async function reconciliationHistory(db: D1Database, statementId?: string, end?: string) {
  const rows = await all(db, `SELECT v.*, u.reason, u.undone_by, u.undone_at, b.name AS bank
    FROM pt_voided_reconciliations v JOIN pt_reconciliation_undos u ON u.id = v.undo_id
    JOIN pt_bank_accounts b ON b.id = v.bank_account_id
    WHERE (? IS NULL OR v.statement_id = ?) AND (? IS NULL OR v.end_date <= ?)
    ORDER BY u.undone_at DESC, u.id, v.sequence`, statementId ?? null, statementId ?? null, end ?? null, end ?? null)
  return rows.map(r => ({ ...r, snapshot: JSON.parse(r.snapshot) }))
}

export async function reconciliationUndoPreview(db: D1Database, statementId: string) {
  const target = await one(db, 'SELECT * FROM pt_reconciliations WHERE statement_id = ?', statementId)
  if (!target) return null
  const reconciliations = await all(db, `SELECT r.*, s.start_date, s.source_name, s.document_id FROM pt_reconciliations r
    JOIN pt_statements s ON s.id = r.statement_id WHERE r.bank_account_id = ? AND r.end_date >= ?
    ORDER BY r.end_date DESC, r.completed_at DESC, r.id DESC`, target.bank_account_id, target.end_date)
  const locked = await all(db, `SELECT DISTINCT p.id FROM pt_periods p WHERE p.status = 'locked' AND EXISTS (
    SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id = r.statement_id
    WHERE r.bank_account_id = ? AND r.end_date >= ? AND p.start_date <= s.end_date AND p.end_date >= s.start_date) ORDER BY p.id`, target.bank_account_id, target.end_date)
  return { reconciliations, locked }
}

const undo: Command = { need: 'reopen', async run(c, b) {
  const statementId = text(b.statementId, 'Statement'), reason = text(b.reason, 'Reason for undoing reconciliation', 1000)
  const preview = await reconciliationUndoPreview(c.db, statementId)
  requireThat(preview, 'Completed reconciliation not found', 404)
  requireThat(!preview.locked.length, `Reopen the locked month${preview.locked.length === 1 ? '' : 's'} first: ${preview.locked.map(p => p.id).join(', ')}. Use Close to request reopening`, 409)
  const ids = preview.reconciliations.map(r => r.id)
  requireThat(Array.isArray(b.reconciliationIds) && JSON.stringify(b.reconciliationIds) === JSON.stringify(ids), 'The reconciliation chain changed; review and confirm the newest-first list again', 409)
  const first = preview.reconciliations[0], target = preview.reconciliations.find(r => r.statement_id === statementId)!
  const id = uid(), stamp = now(), snapshots: Data[] = []
  for (const r of preview.reconciliations) {
    const statement = await one(c.db, 'SELECT * FROM pt_statements WHERE id = ?', r.statement_id)
    const document = await one(c.db, 'SELECT id, name, media_type, size, sha256 FROM pt_documents WHERE id = ?', r.document_id)
    const matches = await all(c.db, 'SELECT id FROM pt_matches WHERE reconciliation_id = ? ORDER BY id', r.id)
    snapshots.push({ reconciliation: { ...r, proof: JSON.parse(r.proof) }, statement, document, matches: matches.map(m => m.id) })
  }
  await run(c.db, [authority(c.actor, 'reopen'),
    guard('(SELECT COUNT(*) FROM pt_reconciliations WHERE bank_account_id = ? AND end_date >= ?) = ?', first.bank_account_id, target.end_date, ids.length),
    ...ids.map(rid => guard('EXISTS (SELECT 1 FROM pt_reconciliations WHERE id = ? AND bank_account_id = ? AND end_date >= ?)', rid, first.bank_account_id, target.end_date)),
    guard(`NOT EXISTS (SELECT 1 FROM pt_periods p JOIN pt_statements s ON p.start_date <= s.end_date AND p.end_date >= s.start_date
      JOIN pt_reconciliations r ON r.statement_id = s.id WHERE p.status = 'locked' AND r.bank_account_id = ? AND r.end_date >= ?)`, first.bank_account_id, target.end_date),
    q('INSERT INTO pt_reconciliation_undos (id, bank_account_id, target_statement_id, reason, undone_by, undone_at) VALUES (?, ?, ?, ?, ?, ?)', id, first.bank_account_id, statementId, reason, c.actor.email, stamp),
    ...preview.reconciliations.flatMap((r, sequence) => [
      q('INSERT INTO pt_voided_reconciliations (id, undo_id, sequence, bank_account_id, statement_id, end_date, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)', r.id, id, sequence, r.bank_account_id, r.statement_id, r.end_date, JSON.stringify(snapshots[sequence])),
      q('UPDATE pt_matches SET reconciliation_id = NULL, revision = ? WHERE reconciliation_id = ?', uid(), r.id),
      q('DELETE FROM pt_reconciliations WHERE id = ?', r.id), changed(),
      audit(who(c.actor), 'reconciliation.undo', 'statement', r.statement_id, { undoId: id, reconciliationId: r.id, reason, sequence, endDate: r.end_date, matches: snapshots[sequence].matches }),
    ]),
  ])
  return { id, undone: ids }
} }

export const reconciliationUndoCommands: Record<string, Command> = { 'reconciliation.undo': undo }
