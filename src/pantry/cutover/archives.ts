import { authority, must, who } from '../access'
import type { Command, Context } from '../context'
import { now, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run, type Sql } from '../db'
import { documentStatements } from '../documents'
import { archivePreviewFiles, prepareArchive } from './archive-prepare'
import { archiveSourceGuard, archiveTarget, ARCHIVE_TABLES } from './archive-sources'
export { archiveOrphanStatements } from './archive-sources'

export async function archivesView(c: Context) {
  must(c.actor, 'owner')
  const [archives, files, links] = await Promise.all([
    all(c.db, `SELECT a.*,COUNT(f.id) AS file_count,COALESCE(SUM(f.size),0) AS byte_count FROM pt_document_archives a LEFT JOIN pt_archive_documents f ON f.archive_id=a.id GROUP BY a.id ORDER BY a.imported_at DESC,a.id`),
    all(c.db, `SELECT f.*,d.name,d.linked_kind,d.linked_id,d.erased_at FROM pt_archive_documents f JOIN pt_documents d ON d.id=f.document_id ORDER BY f.archive_id,d.name`),
    all(c.db, 'SELECT * FROM pt_archive_source_links ORDER BY source_system,source_kind,source_id'),
  ])
  return { archives, files, unlinked: files.filter(f => !f.linked_id && !f.erased_at), links }
}

function mappingStatements(c: Context, system: string, kind: string, sourceId: string, targetId: string, at: string): Sql[] {
  return [
    q('INSERT INTO pt_archive_source_links(source_system,source_kind,source_id,target_id,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_system,source_kind,source_id) DO NOTHING', system, kind, sourceId, targetId, c.actor.email, at),
    guard('EXISTS(SELECT 1 FROM pt_archive_source_links WHERE source_system=? AND source_kind=? AND source_id=? AND target_id=?)', system, kind, sourceId, targetId),
  ]
}

function journalFile(f: Data) {
  const { bytes, evidence, ...metadata } = f
  return { ...metadata, ...(evidence ? { evidence: { ...evidence, record: undefined } } : {}) }
}

export const archiveCommands: Record<string, Command> = {
  'archive.preview': { need: 'owner', async run(c, b) {
    const p = await prepareArchive(c, b)
    return { ...p, files: archivePreviewFiles(p.files) }
  } },
  'archive.import': { need: 'owner', async run(c, b) {
    const p = await prepareArchive(c, b)
    requireThat(b.fingerprint === p.fingerprint, 'Review this exact batch before importing', 409)
    const existing = await one(c.db, 'SELECT * FROM pt_document_archives WHERE provider=? AND archive_key=?', p.provider, p.archiveKey)
    if (existing) {
      requireThat(existing.fingerprint === p.fingerprint, 'This export identity was already imported with different bytes or mappings', 409)
      return { id: existing.id, replayed: true, ...await archivesView(c) }
    }
    const id = uid(), at = now(), statements: Sql[] = [authority(c.actor, 'owner'), q('INSERT INTO pt_document_archives(id,provider,archive_key,fingerprint,imported_at,imported_by) VALUES(?,?,?,?,?,?)', id, p.provider, p.archiveKey, p.fingerprint, at, c.actor.email)]
    for (const f of p.files) {
      statements.push(guard('NOT EXISTS(SELECT 1 FROM pt_documents WHERE sha256=? AND erased_at IS NOT NULL)', f.sha256))
      if (f.linkedId) statements.push(guard(`EXISTS(SELECT 1 FROM ${ARCHIVE_TABLES[f.kind]} WHERE id=?)`, f.linkedId), ...archiveSourceGuard(f), ...mappingStatements(c, f.sourceSystem, f.kind, f.transactionSourceId, f.linkedId, at))
      const doc = await documentStatements(c.actor.email, { name: f.name, mediaType: f.mediaType, bytes: f.bytes, linkedKind: f.linkedId ? f.kind : null, linkedId: f.linkedId, note: `Imported original from ${p.provider}` })
      statements.push(...doc.statements, q('INSERT INTO pt_archive_documents(id,archive_id,source_id,source_system,transaction_source_id,document_id,sha256,size,placed_by) VALUES(?,?,?,?,?,?,?,?,?)', uid(), id, f.sourceId, f.sourceSystem, f.transactionSourceId, doc.id, doc.sha256, f.size, f.linkedId ? c.actor.email : null))
    }
    statements.push(audit(who(c.actor), 'move-in.archive', 'document-archive', id, { provider: p.provider, archiveKey: p.archiveKey, count: p.files.length, bytes: p.total, fingerprint: p.fingerprint, custody: p.custody, files: p.files.map(journalFile) }))
    await run(c.db, statements)
    return { id, ...await archivesView(c) }
  } },
  'archive.place': { need: 'owner', async run(c, b) {
    const f = await one(c.db, 'SELECT f.*,d.linked_id,d.erased_at FROM pt_archive_documents f JOIN pt_documents d ON d.id=f.document_id WHERE f.id=?', text(b.id, 'Archive document'))
    requireThat(f, 'Original is missing', 404)
    requireThat(!f.linked_id && !f.erased_at, 'Only an unplaced retained original can be placed', 409)
    const kind = text(b.kind, 'Record type'), targetId = text(b.targetId, 'Pantry record ID'), at = now()
    const sourceSystem = b.sourceSystem ? text(b.sourceSystem, 'Transaction source system', 100) : f.source_system
    const transactionSourceId = b.transactionSourceId ? text(b.transactionSourceId, 'Transaction source ID', 200) : f.transaction_source_id
    requireThat(!b.transactionSourceId || b.transactionSourceId === transactionSourceId, 'Transaction source ID cannot have surrounding whitespace')
    await archiveTarget(c, kind, targetId)
    await run(c.db, [authority(c.actor, 'owner'), guard(`EXISTS(SELECT 1 FROM ${ARCHIVE_TABLES[kind]} WHERE id=?)`, targetId),
      ...(transactionSourceId ? mappingStatements(c, sourceSystem, kind, transactionSourceId, targetId, at) : []),
      q('UPDATE pt_archive_documents SET revision=revision+1,placed_by=?,source_system=?,transaction_source_id=? WHERE id=? AND revision=?', c.actor.email, sourceSystem, transactionSourceId, f.id, b.revision), changed(),
      q('UPDATE pt_documents SET linked_kind=?,linked_id=? WHERE id=? AND linked_id IS NULL AND erased_at IS NULL', kind, targetId, f.document_id), changed(),
      audit(who(c.actor), 'move-in.archive-place', 'document', f.document_id, { archiveId: f.archive_id, sourceId: f.source_id, sha256: f.sha256, sourceSystem, transactionSourceId, mappingSource: 'owner-confirmed', linkedKind: kind, linkedId: targetId }),
    ])
    return archivesView(c)
  } },
}
