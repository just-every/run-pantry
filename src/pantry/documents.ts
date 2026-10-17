// Document bytes. A file up to one D1 value is kept in its row; a larger one
// (a phone photo, a long emailed PDF) is kept in ordered parts. Either way the
// row holds the SHA-256 of the whole file and the bytes come back unchanged.
import { now, requireThat, sha256, uid } from './core'
import { all, one, q, type Sql } from './db'

const PART = 1_000_000
export const MAX_DOCUMENT_BYTES = 12_000_000

export type NewDocument = { name: string; mediaType: string; bytes: Uint8Array; linkedKind?: string | null; linkedId?: string | null; note?: string }

export async function documentStatements(by: string, input: NewDocument) {
  requireThat(input.bytes.length > 0 && input.bytes.length <= MAX_DOCUMENT_BYTES, 'Files are 1 byte to 12 MB')
  const id = uid(), hash = await sha256(input.bytes), split = input.bytes.length > PART
  const statements: Sql[] = [q('INSERT INTO pt_documents (id, name, media_type, size, sha256, content, linked_kind, linked_id, note, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, input.name.slice(0, 200), input.mediaType, input.bytes.length, hash, split ? new Uint8Array(0) : input.bytes, input.linkedKind ?? null, input.linkedId ?? null, (input.note ?? '').slice(0, 500), by, now())]
  if (split) for (let seq = 0; seq * PART < input.bytes.length; seq++)
    statements.push(q('INSERT INTO pt_document_parts (document_id, seq, content) VALUES (?, ?, ?)', id, seq, input.bytes.slice(seq * PART, (seq + 1) * PART)))
  return { id, sha256: hash, statements }
}

/** The document's exact bytes, joined from its parts when it has them. */
export async function documentFile(db: D1Database, id: string) {
  const doc = await one<{ name: string; media_type: string; size: number; sha256: string; content: ArrayBuffer }>(db, 'SELECT name, media_type, size, sha256, content FROM pt_documents WHERE id = ?', id)
  if (!doc) return null
  let bytes = new Uint8Array(doc.content as ArrayBuffer)
  if (bytes.length !== doc.size) {
    const parts = await all<{ content: ArrayBuffer }>(db, 'SELECT content FROM pt_document_parts WHERE document_id = ? ORDER BY seq', id)
    bytes = new Uint8Array(doc.size)
    let at = 0
    for (const p of parts) { const chunk = new Uint8Array(p.content); bytes.set(chunk, at); at += chunk.length }
    requireThat(at === doc.size, 'This document is incomplete', 500)
  }
  return { name: doc.name, mediaType: doc.media_type, sha256: doc.sha256, bytes }
}
