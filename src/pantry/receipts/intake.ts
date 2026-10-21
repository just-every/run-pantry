// A receipt arrives (a phone photo, an uploaded file or a forwarded email):
// its original is stored byte for byte with its SHA-256, the install's model
// reads it if it can, and it waits for a person, unless a rule the business
// set attaches it.
import type { Bindings } from '../../auth.server'
import { now, uid, type Data } from '../core'
import { all, audit, one, q, run, type AuditActor, type Sql } from '../db'
import { documentStatements, type NewDocument } from '../documents'
import { readReceipt, ReaderError, type Category, type Reading, type ReceiptInput } from './reader'
import { readerState } from './settings'
import { flagDuplicate, vendorKey } from './duplicates'
import { vendorReadingColumns } from './vendor-details'

export const MAX_IMAGE_TO_READ = 3_700_000
const IMAGE = /^image\/(png|jpeg|webp|gif)$/

/** What the model should read from a stored file, or why it cannot. */
export function readable(doc: NewDocument): ReceiptInput | string {
  if (doc.mediaType === 'application/pdf') return { kind: 'pdf', mediaType: doc.mediaType, bytes: doc.bytes, name: doc.name }
  if (IMAGE.test(doc.mediaType)) return doc.bytes.length <= MAX_IMAGE_TO_READ ? { kind: 'image', mediaType: doc.mediaType, bytes: doc.bytes, name: doc.name } : 'This photo is too large to read; take it again or upload a smaller copy.'
  if (doc.mediaType.startsWith('text/')) return { kind: 'text', text: new TextDecoder().decode(doc.bytes), name: doc.name }
  return 'Pantry reads photos (PNG, JPEG, WebP), PDFs and emails; this file is kept but not read.'
}

export async function categories(db: D1Database): Promise<(Category & { id: string })[]> {
  return all(db, "SELECT id, code, name FROM pt_accounts WHERE active = 1 AND type = 'expense' ORDER BY code")
}

export type ReadOutcome = { status: 'read' | 'failed' | 'no-key' | 'unavailable'; note: string; model: string | null; reading: Reading | null }

export async function readWith(db: D1Database, env: Bindings, input: ReceiptInput | string): Promise<ReadOutcome> {
  const state = await readerState(db, env)
  if ('unavailable' in state) return { status: 'unavailable', note: state.unavailable, model: null, reading: null }
  if ('missing' in state) return { status: 'no-key', note: state.missing, model: null, reading: null }
  if (typeof input === 'string') return { status: 'failed', note: input, model: null, reading: null }
  try {
    const reading = await readReceipt(state.config, input, await categories(db))
    return { status: 'read', note: reading.receipt ? reading.note : `This does not look like a receipt. ${reading.note}`.trim(), model: state.config.model, reading }
  } catch (e) {
    if (!(e instanceof ReaderError)) console.error(e)
    return { status: 'failed', note: e instanceof ReaderError ? e.message : 'The AI model could not be reached.', model: state.config.model, reading: null }
  }
}

/** The receipt columns a reading fills. */
export async function readingColumns(db: D1Database, r: ReadOutcome) {
  const account = r.reading?.category ? await one<{ id: string }>(db, 'SELECT id FROM pt_accounts WHERE code = ?', r.reading.category) : null
  return { read_match_fields: JSON.stringify({ tip: r.reading?.tip ?? null, chargedUsd: r.reading?.chargedUsd ?? null, cardLast4: r.reading?.cardLast4 ?? null }), ...await vendorReadingColumns(r.reading?.vendorDetails), read_draft_fields: r.reading?.draft ? JSON.stringify(r.reading.draft) : null, read_status: r.status, read_note: r.note, read_model: r.model, read_at: now(), read_vendor: r.reading?.vendor ?? null, read_invoice_number: r.reading?.invoiceNumber ?? null, read_date: r.reading?.date ?? null, read_total_cents: r.reading?.total ?? null, read_tax_cents: r.reading?.tax ?? null, read_currency: r.reading?.currency ?? null, read_account_id: account?.id ?? null }
}

export type Arrival = {
  by: AuditActor; source: 'upload' | 'camera' | 'email'; sender?: string; subject?: string
  original: NewDocument; file?: NewDocument | null; read: ReceiptInput | string; guards?: Sql[]
  publication?: (receiptId: string, documentId: string) => Sql[]
}

/** Store, read and file one receipt for review; returns its id. A reading made elsewhere (the demo's) is passed as `read`. */
export async function receive(db: D1Database, env: Bindings, a: Arrival, read?: ReadOutcome) {
  const outcome = read ?? await readWith(db, env, a.read)
  const original = await documentStatements(a.by.email, a.original)
  const file = a.file ? await documentStatements(a.by.email, a.file) : null
  const id = uid(), cols = await readingColumns(db, outcome)
  await run(db, [...(a.guards ?? []), ...original.statements, ...(file?.statements ?? []),
    q(`INSERT INTO pt_receipts (id, document_id, file_document_id, source, sender, subject, read_status, read_note, read_model, read_at, read_vendor, read_date, read_total_cents, read_tax_cents, read_currency, read_account_id, status, received_by, received_at, revision, vendor_key, read_invoice_number, read_vendor_details, read_draft_fields, read_match_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, original.id, file?.id ?? null, a.source, (a.sender ?? '').slice(0, 254), (a.subject ?? '').slice(0, 300), cols.read_status, cols.read_note, cols.read_model, cols.read_at,
      cols.read_vendor, cols.read_date, cols.read_total_cents, cols.read_tax_cents, cols.read_currency, cols.read_account_id, a.by.email, now(), uid(), vendorKey(cols.read_vendor), cols.read_invoice_number, cols.read_vendor_details, cols.read_draft_fields, cols.read_match_fields),
    ...(a.publication?.(id, original.id) ?? []),
    audit(a.by, 'receipt.receive', 'receipt', id, { source: a.source, file: a.original.name, sha256: original.sha256, read: outcome.status })])
  await flagDuplicate(db, (await receipt(db, id))!)
  return { id, outcome }
}

export async function receipt(db: D1Database, id: string): Promise<Data | null> {
  return one(db, 'SELECT * FROM pt_receipts WHERE id = ?', id)
}
