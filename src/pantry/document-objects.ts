import type { Bindings } from '../auth.server'
import { all, one } from './db'
import { documentFile } from './documents'
import { requireThat, sha256 } from './core'

/** D1 keeps a recovery mirror so ordinary archives remain self-contained.
 * A receipt is reserved before upload: erasure can find even an in-flight copy.
 */
export async function syncDocumentObjects(env: Bindings, limit = 32) {
  const bucket = env.PANTRY_DOCUMENTS
  if (!bucket) return
  const db = env.DB
  // Never remove the receipt before the provider confirms deletion. Failed
  // cleanup remains discoverable and the next mutation or Cron retries it.
  const erased = await all<{document_id:string;object_key:string}>(db,
    'SELECT o.document_id,o.object_key FROM pt_document_objects o JOIN pt_documents d ON d.id=o.document_id WHERE d.erased_at IS NOT NULL')
  for (const object of erased) {
    await bucket.delete(object.object_key)
    await db.prepare('DELETE FROM pt_document_objects WHERE document_id=?').bind(object.document_id).run()
  }
  const pending = await all<{id:string;sha256:string}>(db,
    'SELECT d.id,d.sha256 FROM pt_documents d LEFT JOIN pt_document_objects o ON o.document_id=d.id WHERE d.erased_at IS NULL AND COALESCE(o.ready,0)=0 ORDER BY d.id LIMIT ?', limit)
  for (const doc of pending) {
    const key = `documents/${doc.id}-${doc.sha256}`
    await db.prepare('INSERT OR IGNORE INTO pt_document_objects(document_id,object_key) SELECT id,? FROM pt_documents WHERE id=? AND erased_at IS NULL').bind(key,doc.id).run()
    const current = await one<{erased_at:string|null}>(db,'SELECT erased_at FROM pt_documents WHERE id=?',doc.id)
    if (!current || current.erased_at) continue
    const file = await documentFile(db,doc.id)
    requireThat(file && await sha256(file.bytes)===doc.sha256,'Document recovery bytes do not match their recorded hash',500)
    await bucket.put(key,file.bytes,{httpMetadata:{contentType:file.mediaType},customMetadata:{sha256:doc.sha256}})
    const stored = await bucket.get(key)
    requireThat(stored && await sha256(new Uint8Array(await stored.arrayBuffer()))===doc.sha256,'Stored document does not match its recorded hash',500)
    // If erasure won during upload, withdraw the new copy as well. If it wins
    // after this check, its own cleanup finds the reserved receipt above.
    const live = await one(db,'SELECT id FROM pt_documents WHERE id=? AND erased_at IS NULL AND sha256=?',doc.id,doc.sha256)
    if (!live) {
      await bucket.delete(key)
      await db.prepare('DELETE FROM pt_document_objects WHERE document_id=?').bind(doc.id).run()
    } else await db.prepare('UPDATE pt_document_objects SET ready=1 WHERE document_id=?').bind(doc.id).run()
  }
}
