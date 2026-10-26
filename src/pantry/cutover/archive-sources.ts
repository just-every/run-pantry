import type { Context } from '../context'
import { requireThat, type Data } from '../core'
import { all, guard, one, q, type Sql } from '../db'

export const ARCHIVE_TABLES: Record<string, string> = { invoice: 'pt_invoices', bill: 'pt_bills', journal: 'pt_journal_entries', payment: 'pt_payments', statement: 'pt_statements', history: 'pt_history_lines' }
const NAMESPACES: Record<string, string> = { 'quickbooks-online': 'qbo-cutover', xero: 'xero-cutover', spreadsheet: 'spreadsheet-cutover' }

export async function archiveTarget(c: Context, kind: string, id: string) {
  requireThat(ARCHIVE_TABLES[kind], 'Choose a supported transaction type')
  requireThat(await one(c.db, `SELECT id FROM ${ARCHIVE_TABLES[kind]} WHERE id=?`, id), 'Mapped transaction is missing', 404)
}

/** Exact published identities only. Several matching targets are presented for
 * owner placement; they are never broken by numbers, names, dates or filenames. */
export async function archiveSource(c: Context, system: string, sourceId: string, kind: string): Promise<Data> {
  if (!sourceId) return { linkedId: null, kind, mappingSource: 'unidentified', candidates: [] }
  const confirmed = await all(c.db, `SELECT * FROM pt_archive_source_links WHERE source_system=? AND source_id=?${kind ? ' AND source_kind=?' : ''}`, system, sourceId, ...kind ? [kind] : [])
  const candidates: Data[] = []
  for (const link of confirmed) if (ARCHIVE_TABLES[link.source_kind] && await one(c.db, `SELECT id FROM ${ARCHIVE_TABLES[link.source_kind]} WHERE id=?`, link.target_id)) {
    candidates.push({ kind: link.source_kind, targetId: link.target_id, mappingSource: 'confirmed-source-id', evidence: { system, sourceId, kind: link.source_kind, targetId: link.target_id } })
  }
  // A confirmed owner or import mapping takes priority over older publications.
  if (!candidates.length) {
    for (const table of ['ik_provenance', 'ik_d1_history']) {
      const rows = await all(c.db, `SELECT p.id,p.record_json,p.target_kind,p.target_id FROM ${table} p JOIN ik_jobs j ON j.id=p.job_id WHERE p.destination='books' AND j.namespace IN (?,?) AND p.reversed=0 AND json_extract(p.record_json,'$.sourceId')=?${kind ? " AND json_extract(p.record_json,'$.sourceKind')=?" : ''}`, NAMESPACES[system] ?? system, system, sourceId, ...kind ? [kind] : [])
      for (const p of rows) if (ARCHIVE_TABLES[p.target_kind] && (!kind || kind === p.target_kind) && await one(c.db, `SELECT id FROM ${ARCHIVE_TABLES[p.target_kind]} WHERE id=?`, p.target_id)) {
        candidates.push({ kind: p.target_kind, targetId: p.target_id, mappingSource: 'import-source-id', evidence: { table, id: p.id, record: p.record_json } })
      }
    }
  }
  const targets = [...new Map(candidates.map(p => [`${p.kind}:${p.targetId}`, p])).values()]
  return targets.length === 1 ? { linkedId: targets[0].targetId, kind: targets[0].kind, mappingSource: targets[0].mappingSource, evidence: targets[0].evidence, candidates: targets.map(({ evidence, ...p }) => p) }
    : { linkedId: null, kind, mappingSource: targets.length ? 'ambiguous-source-id' : 'unknown-source-id', candidates: targets.map(({ evidence, ...p }) => p) }
}

export function archiveSourceGuard(file: Data): Sql[] {
  const e = file.evidence
  if (!e) return []
  if (file.mappingSource === 'confirmed-source-id') return [guard('EXISTS(SELECT 1 FROM pt_archive_source_links WHERE source_system=? AND source_kind=? AND source_id=? AND target_id=?)', e.system, e.kind, e.sourceId, e.targetId)]
  requireThat(['ik_provenance', 'ik_d1_history'].includes(e.table), 'Unknown source-ID evidence')
  return [guard(`EXISTS(SELECT 1 FROM ${e.table} WHERE id=? AND record_json=? AND reversed=0)`, e.id, e.record)]
}

/** Call in the same atomic batch after a cutover undo removes native targets.
 * Originals and their hashes remain intact; detached files rejoin the queue. */
export function archiveOrphanStatements(): Sql[] {
  const missing = Object.entries(ARCHIVE_TABLES).map(([kind, table]) => `(linked_kind='${kind}' AND NOT EXISTS(SELECT 1 FROM ${table} t WHERE t.id=pt_documents.linked_id))`).join(' OR ')
  const missingSource = Object.entries(ARCHIVE_TABLES).map(([kind, table]) => `(source_kind='${kind}' AND NOT EXISTS(SELECT 1 FROM ${table} t WHERE t.id=pt_archive_source_links.target_id))`).join(' OR ')
  return [
    q(`UPDATE pt_archive_documents SET revision=revision+1,placed_by=NULL WHERE document_id IN (SELECT id FROM pt_documents WHERE (${missing}))`),
    q(`UPDATE pt_documents SET linked_kind=NULL,linked_id=NULL WHERE id IN (SELECT document_id FROM pt_archive_documents) AND (${missing})`),
    q(`DELETE FROM pt_archive_source_links WHERE ${missingSource}`),
  ]
}
