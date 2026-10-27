// D1 owns custody before any R2 write. A zero-byte tombstone permanently
// occupies an erased key, so a delayed create-only upload cannot resurrect it.
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
export async function stagedDocumentBytes(db, doc) {
  let bytes = new Uint8Array(doc.content)
  if (bytes.length !== doc.size) {
    bytes = new Uint8Array(doc.size)
    const parts = (await db.prepare('SELECT content FROM pt_document_parts WHERE document_id=? ORDER BY seq').bind(doc.id).all()).results
    let offset = 0
    for (const part of parts) { const value = new Uint8Array(part.content); bytes.set(value, offset); offset += value.length }
    if (offset !== doc.size) throw new Error('document_incomplete')
  }
  if (bytes.length !== doc.size || await digest(bytes) !== doc.sha256) throw new Error('document_integrity')
  return bytes
}

/** Bounded, restartable work. A failure leaves the authoritative D1 bytes or
 * erasure request intact. Call until pending is zero before taking an archive. */
export async function drainDocumentObjects(db, bucket, limit = 32) {
  const work = (await db.prepare("SELECT * FROM pt_document_objects WHERE state IN ('staged','erase-pending') ORDER BY CASE state WHEN 'erase-pending' THEN 0 ELSE 1 END,object_key LIMIT ?").bind(limit).all()).results
  if (work.length && !bucket) throw new Error('PANTRY_DOCUMENTS binding is required')
  for (const item of work) {
    if (item.state === 'erase-pending') {
      await bucket.put(item.object_key, new Uint8Array(0), { httpMetadata: { contentType: 'application/octet-stream' } })
      await db.prepare("UPDATE pt_document_objects SET state='erased' WHERE object_key=? AND state='erase-pending'").bind(item.object_key).run()
      continue
    }
    const doc = await db.prepare('SELECT id,content,size,sha256,media_type,erased_at FROM pt_documents WHERE id=? AND EXISTS(SELECT 1 FROM pt_document_objects o WHERE o.document_id=pt_documents.id AND o.state='staged')').bind(item.document_id).first()
    if (!doc || doc.erased_at) continue // its transactional trigger queued erasure
    const bytes = await stagedDocumentBytes(db, doc)
    // Never overwrite an existing original or an erasure tombstone.
    await bucket.put(item.object_key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: doc.media_type } })
    const object = await bucket.get(item.object_key)
    const current = await db.prepare('SELECT state FROM pt_document_objects WHERE object_key=?').bind(item.object_key).first()
    if (current?.state !== 'staged') continue
    if (!object || object.size !== doc.size || await digest(await object.arrayBuffer()) !== doc.sha256) throw new Error('document_object_integrity')
    // Release staged bytes only while the document still belongs to this upload.
    await db.batch([
      db.prepare("UPDATE pt_document_objects SET state='ready' WHERE object_key=? AND state='staged' AND EXISTS(SELECT 1 FROM pt_documents WHERE id=? AND erased_at IS NULL AND sha256=?)").bind(item.object_key, doc.id, doc.sha256),
      db.prepare("UPDATE pt_documents SET content=X'' WHERE id=? AND erased_at IS NULL AND EXISTS(SELECT 1 FROM pt_document_objects WHERE document_id=? AND state='ready')").bind(doc.id, doc.id),
      db.prepare("DELETE FROM pt_document_parts WHERE document_id=? AND EXISTS(SELECT 1 FROM pt_document_objects WHERE document_id=? AND state='ready')").bind(doc.id, doc.id),
    ])
  }
  return (await db.prepare("SELECT count(*) AS n FROM pt_document_objects WHERE state IN ('staged','erase-pending')").first()).n
}
