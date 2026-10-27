// Policy changes and owner-confirmed expiry are atomic journaled writes.
import type { Command } from '../context'
import { now, requireThat, sha256, uid } from '../core'
import { audit, changed, guard, one, q, run, type Sql } from '../db'
import { who } from '../access'
import { fenceStatements } from './fence'
import { ownerSession } from './owner'
import { cancelErased } from '../webhooks/erasure'
import { invoicePdf, type InvoiceDocument } from '../invoice-pdf'
import { expireSiblingEvidence } from '../estimates/siblings/custody'
import { erasureView, retainedState, itemKey, stateRevision, expiry, expired, type RetentionItem } from './retention-items'
export { erasureView, retentionItems, retainStatements } from './retention-items'

const save: Command = { need: 'owner', async run(c, b) {
  const auth = await ownerSession(c), years = Number(b.years)
  requireThat(Number.isSafeInteger(years) && years >= 1, 'Retention is a whole number of years, minimum 1')
  const state = await retainedState(c.db), revision = uid()
  requireThat(b.revision === await stateRevision(state), 'Retention settings or supporting records changed; reload', 409)
  await run(c.db, [...auth, ...state.guards,
    guard('EXISTS(SELECT 1 FROM pt_retention_settings WHERE id=1 AND revision=?)', state.settings.revision),
    q('UPDATE pt_retention_settings SET years=?,revision=? WHERE id=1 AND revision=?', years, revision, state.settings.revision), changed(),
    ...state.items.map(i => q('UPDATE pt_retained_items SET clock=?,expires=?,revision=? WHERE table_name=? AND row_id=? AND erased_at IS NULL', i.clock, expiry(i.clock, years), i.revision, i.table, i.id)),
    audit(who(c.actor), 'retention.save', 'retention', '1', { years, revision, unerasedItems: state.items.length }),
  ])
  return erasureView(c.db)
} }

async function expiryStatements(db: D1Database, item: RetentionItem, erasureId: string, at: string): Promise<Sql[]> {
  if (item.table === 'pt_estimate_sibling_links') return expireSiblingEvidence(db, item.id, erasureId, at)
  const scoped = q("INSERT INTO pt_erasure_scope(erasure_id,table_name,row_id,operation) VALUES(?,?,?,'expire')", erasureId, item.table, item.id)
  if (item.table === 'pt_documents') return [scoped,
    guard('EXISTS(SELECT 1 FROM pt_documents WHERE id=? AND sha256=? AND erased_at IS NULL)', item.id, item.sha256),
    q('DELETE FROM pt_document_parts WHERE document_id=?', item.id),
    q("UPDATE pt_documents SET content=?,name='[erased]',note='[erased]',capture_vendor=NULL,capture_invoice_number=NULL,duplicate_reason=NULL,erased_at=? WHERE id=? AND erased_at IS NULL", new Uint8Array(0), at, item.id), changed(),
  ]
  if(item.table==='pt_estimate_documents'){
    const [estimateId,revision]=item.id.split(':')
    return [scoped,q("UPDATE pt_estimate_documents SET pdf_base64='',document='{}',accepted_pdf_base64='',accepted_document='{}',erased_at=? WHERE estimate_id=? AND revision=? AND sha256=? AND erased_at IS NULL",at,estimateId,revision,item.sha256),changed()]
  }
  if (item.table === 'pt_invoice_documents') {
    const row = await one(db, 'SELECT sha256,document FROM pt_invoice_documents WHERE invoice_id=? AND erased_at IS NULL', item.id)
    requireThat(row, 'The retained document changed; reload', 409)
    // Upgrade snapshots have never emitted bytes. Hash their deterministic PDF
    // in memory and discard it in the same journaled operation.
    item.sha256 = row.sha256 ?? await sha256(invoicePdf(JSON.parse(row.document) as InvoiceDocument))
    return [scoped, guard('EXISTS(SELECT 1 FROM pt_invoice_documents WHERE invoice_id=? AND sha256 IS ? AND document=? AND erased_at IS NULL)', item.id, row.sha256, row.document),
      q("UPDATE pt_invoice_documents SET pdf_base64='',document='{}',sha256=?,erased_at=? WHERE invoice_id=? AND erased_at IS NULL", item.sha256, at, item.id), changed(),
      q('UPDATE pt_invoices SET issued_pdf_sha256=? WHERE id=?', item.sha256, item.id)]
  }
  return [scoped,
    q("UPDATE pt_contractor_tax SET tin=NULL,tin_last4=NULL,tin_hash=NULL,w9_evidence_sealed=NULL,w9_evidence_history='[]',w9_completed_at=NULL,erased_at=?,revision=? WHERE contact_id=? AND erased_at IS NULL", at, uid(), item.id), changed(),
  ]
}

const erase: Command = { need: 'owner', async run(c, b) {
  const auth = await ownerSession(c)
  requireThat(b.confirm === 'ERASE', 'Type ERASE to confirm removal of expired retained values')
  requireThat(Array.isArray(b.ids) && b.ids.length > 0 && b.ids.length <= 100 && b.ids.every((id: unknown) => typeof id === 'string'), 'Choose 1–100 expired items')
  const state = await retainedState(c.db), chosen = [...new Set<string>(b.ids)]
  requireThat(b.revision === await stateRevision(state), 'Retention settings or supporting records changed; reload', 409)
  const today = now().slice(0, 10), selected = chosen.map(id => {
    const matches = state.items.filter(i => itemKey(i) === id || i.id === id)
    requireThat(matches.length === 1, `Retained item ${id} changed or was already erased; reload`, 409)
    requireThat(expired(matches[0].expires, today), `Retained item ${id} is not expired until ${matches[0].expires}`, 409)
    return matches[0]
  })
  requireThat(new Set(selected.map(itemKey)).size === selected.length, 'Choose each retained item once')
  const id = uid(), at = now(), counts: Record<string, { itemsErased: number; bytesRemoved: number; bytesRemovalQueued?: number; fieldsReplaced: number }> = {}
  const cancelled = await cancelErased(c.db, '', selected.map(i => i.id))
  const mutations = (await Promise.all(selected.map(i => expiryStatements(c.db, i, id, at)))).flat()
  for (const item of selected) {
    const count = counts[item.table] ??= { itemsErased: 0, bytesRemoved: 0, fieldsReplaced: 0 }
    if(item.table==='pt_estimate_sibling_links'){count.bytesRemoved+=Number((await one(c.db,'SELECT COALESCE(length(pdf_base64)*3/4,0)+length(proof) AS n FROM pt_estimate_sibling_links WHERE id=?',item.id))?.n??0);count.fieldsReplaced+=3}
    if(item.table==='pt_estimate_documents'){const [e,r]=item.id.split(':');count.bytesRemoved+=Number((await one(c.db,'SELECT (length(pdf_base64)+COALESCE(length(accepted_pdf_base64),0))*3/4 AS n FROM pt_estimate_documents WHERE estimate_id=? AND revision=?',e,r))?.n??0);count.fieldsReplaced+=4}
    count.itemsErased++; count.fieldsReplaced += item.table === 'pt_contractor_tax' ? 1 : item.table === 'pt_invoice_documents' ? 2 : 0
    if (item.table === 'pt_documents') {
      const doc = await one(c.db, `SELECT size, 1+(name<>'[erased]')+(note<>'[erased]')+(capture_vendor IS NOT NULL)+(capture_invoice_number IS NOT NULL)+(duplicate_reason IS NOT NULL) AS fields FROM pt_documents WHERE id=?`, item.id)
      count.bytesRemovalQueued = (count.bytesRemovalQueued ?? 0) + Number(doc?.size ?? 0); count.fieldsReplaced += Number(doc?.fields ?? 0)
    }
    if (item.table === 'pt_invoice_documents') count.bytesRemoved += Number((await one(c.db, `SELECT length(pdf_base64)*3/4-CASE WHEN substr(pdf_base64,-2)='==' THEN 2 WHEN substr(pdf_base64,-1)='=' THEN 1 ELSE 0 END AS n FROM pt_invoice_documents WHERE invoice_id=?`, item.id))?.n ?? 0)
  }
  const receipt = { id, at, action: 'retention.expire', counts: {...counts,pt_webhook_deliveries:{attemptsCancelled:cancelled.count}}, retained: state.items.filter(i => !selected.some(s => itemKey(s) === itemKey(i))).map(i => ({ table: i.table, id: i.id, expires: i.expires })),
    erased: selected.map(i => ({ table: i.table, id: i.id, clock: i.clock, expires: i.expires, ...(i.sha256 ? { sha256: i.sha256 } : {}) })),
    exclusions: ['posted-entry free text', 'connected services', 'downloaded files', 'earlier backups'] }
  await run(c.db, [...auth, ...state.guards,
    guard('EXISTS(SELECT 1 FROM pt_retention_settings WHERE id=1 AND revision=?)', state.settings.revision),
    q('INSERT INTO pt_erasure_journal(id,subject_digest,at,receipt) VALUES(?,?,?,?)', id, await sha256(selected.map(itemKey).sort().join('\n')), at, JSON.stringify(receipt)),
    ...await fenceStatements(c.db), ...cancelled.statements, ...mutations,
    ...selected.map(i => q('UPDATE pt_retained_items SET clock=?,expires=?,erased_at=? WHERE table_name=? AND row_id=? AND erased_at IS NULL', i.clock, i.expires, at, i.table, i.id)),
    q('DELETE FROM pt_erasure_scope WHERE erasure_id=?', id),
    audit(who(c.actor), 'retention.erase', 'erasure', id, { count: selected.length }),
  ])
  return receipt
} }

export const retentionCommands: Record<string, Command> = { 'retention.save': save, 'retention.erase': erase }
