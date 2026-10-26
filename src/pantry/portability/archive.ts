import type { Context } from '../context'
import { requireThat, sha256, type Data } from '../core'
import { all, one } from '../db'
import { documentFile } from '../documents'
import { type ExportFile } from './files'
import { safeName } from './format'
import { block, ref, type Destination, type Plan, type Snapshot } from './types'
import { exportAuthority } from './read'

export async function originalFiles(c: Context, s: Snapshot, plan: Plan, destination: Destination) {
  const files: ExportFile[] = [], inventory: Data[] = [], attachments: Data[] = []
  for (const d of s.documents) {
    if (d.erased_at) { block(plan, `Document:${d.id}`, 'Original bytes were erased after retention expiry; no replacement document was generated.'); inventory.push({ ...d, available: false }); continue }
    const original = await documentFile(c.db, d.id)
    requireThat(original && original.bytes.length === d.size && await sha256(original.bytes) === d.sha256, `Original document ${d.id} failed its stored size or SHA-256 check`, 409)
    const file = `originals/${safeName(d.id)}/${safeName(d.name)}`
    files.push({ name: file, data: original.bytes })
    inventory.push({ ...d, available: true, file })
    const entryIds = s.entries.filter(e => (s.entryDocuments[e.id] ?? []).some(doc => doc.id === d.id)).map(e => e.id)
    const targets = plan.operations.filter(op => op.journalIds.some(id => entryIds.includes(id)))
    if (!targets.length) block(plan, `Document:${d.id}`, 'Original is preserved in the ZIP but its posted source has no supported destination attachment target yet.')
    for (const target of targets) {
      const common = { sourceFile: file, sourceId: d.id, sha256: d.sha256, size: d.size, mediaType: d.media_type, target: target.key }
      if (destination === 'qbo') {
        const resource = target.responseId.split('.')[0]
        attachments.push({ ...common, method: 'POST', path: '/v3/company/{realmId}/upload', encoding: 'multipart/form-data', metadataPart: 'file_metadata_01', contentPart: 'file_content_01', metadata: { FileName: safeName(d.name), ContentType: d.media_type, AttachableRef: [{ EntityRef: { type: resource, value: ref(target.key) } }] } })
      } else {
        const endpoint = target.path.split('/')[3]
        if (!['Invoices','CreditNotes','ManualJournals','BankTransactions','BankTransfers'].includes(endpoint)) { block(plan, `Document:${d.id}`, `Xero does not expose a supported original-file attachment endpoint for ${endpoint}; retain the hashed original archive.`); continue }
        attachments.push({ ...common, method: 'POST', path: `/api.xro/2.0/${endpoint}/{ref:${target.key}}/Attachments/${encodeURIComponent(safeName(d.name))}`, encoding: 'raw bytes' })
      }
    }
  }
  return { files, inventory, attachments }
}

/** A reopened period or revoked reader cannot release an export prepared under older authority. */
export async function assertSnapshotStillClosed(c: Context, s: Snapshot) {
  await exportAuthority(c)
  const [periods,entries,entity] = await Promise.all([
    all(c.db, 'SELECT id,status,revision FROM pt_periods WHERE start_date<=? AND end_date>=?', s.end, s.start),
    all(c.db, "SELECT id,revision FROM pt_journal_entries WHERE status='posted' AND entry_date<=? ORDER BY id", s.end),
    one(c.db, 'SELECT revision FROM pt_entity WHERE id=1'),
  ])
  requireThat(s.periods.every(p => periods.some(current => current.id === p.id && current.status === 'locked' && current.revision === p.revision)), 'A period changed while preparing the export; close it and export again', 409)
  const before = s.entries.map(e => ({id:e.id,revision:e.revision})).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  requireThat(JSON.stringify(before)===JSON.stringify(entries) && entity?.revision===s.entity.revision, 'Posted history or business settings changed while preparing the export; export again', 409)
}
