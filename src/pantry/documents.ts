// Uploads commit staged bytes atomically with their bookkeeping. The custody
// worker promotes verified originals to private R2, then releases D1 bytes.
import { now, requireThat, sha256, uid } from './core'
import { one, q, type Sql } from './db'
import { stagedDocumentBytes } from './document-objects.mjs'

const PART = 1_000_000
export const MAX_DOCUMENT_BYTES = 25_000_000

export type NewDocument = { name: string; mediaType: string; bytes: Uint8Array; linkedKind?: string | null; linkedId?: string | null; note?: string }

export async function documentStatements(by: string, input: NewDocument) {
  requireThat(input.bytes.length > 0 && input.bytes.length <= MAX_DOCUMENT_BYTES, 'Files are 1 byte to 25 MB')
  const id = uid(), hash = await sha256(input.bytes), split = input.bytes.length > PART
  const statements: Sql[] = [q('INSERT INTO pt_documents (id, name, media_type, size, sha256, content, linked_kind, linked_id, note, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, input.name.slice(0, 200), input.mediaType, input.bytes.length, hash, split ? new Uint8Array(0) : input.bytes, input.linkedKind ?? null, input.linkedId ?? null, (input.note ?? '').slice(0, 500), by, now())]
  if (split) for (let seq = 0; seq * PART < input.bytes.length; seq++)
    statements.push(q('INSERT INTO pt_document_parts (document_id, seq, content) VALUES (?, ?, ?)', id, seq, input.bytes.slice(seq * PART, (seq + 1) * PART)))
  return { id, sha256: hash, statements }
}

/** Read through the existing authorized route; never issue a public object URL. */
export async function documentFile(db: D1Database, id: string, bucket?: R2Bucket) {
  const doc = await one<{ id: string; name: string; media_type: string; size: number; sha256: string; content: ArrayBuffer; erased_at: string|null; object_key: string; state: string }>(db, 'SELECT d.*,o.object_key,o.state FROM pt_documents d JOIN pt_document_objects o ON o.document_id=d.id WHERE d.id=?', id)
  if (!doc) return null
  requireThat(!doc.erased_at, 'This document’s bytes were erased after retention expiry', 410)
  let bytes: Uint8Array
  if (doc.state === 'ready') {
    requireThat(bucket, 'Private document storage is unavailable', 503)
    const object = await bucket.get(doc.object_key)
    requireThat(object, 'This document is incomplete', 500)
    bytes = new Uint8Array(await object.arrayBuffer())
    requireThat(bytes.length === doc.size && await sha256(bytes) === doc.sha256, 'This document failed its integrity check', 500)
  } else {
    requireThat(doc.state === 'staged', 'This document’s bytes were erased after retention expiry', 410)
    bytes = await stagedDocumentBytes(db, doc)
  }
  // Erasure can commit while the object body is being read.
  const live = await one<{erased_at:string|null}>(db, 'SELECT erased_at FROM pt_documents WHERE id=?', id)
  requireThat(live && !live.erased_at, 'This document’s bytes were erased after retention expiry', 410)
  return { name: doc.name, mediaType: doc.media_type, sha256: doc.sha256, bytes }
}
