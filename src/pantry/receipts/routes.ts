// Receipts over HTTP: the capture upload (multipart, so a phone photo arrives
// as its own bytes), the review view, and the local stand-in for delivered mail.
import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { authority, must, person, who } from '../access'
import { cents, date, Fault, optionalText, requireThat, type Data } from '../core'
import { all } from '../db'
import { MAX_DOCUMENT_BYTES } from '../documents'
import type { Command, Context } from '../context'
import { candidates } from './attachments'
import { categories, readable, receive } from './intake'
import { emailReadable, inboxView, mailCommands, MAX_EMAIL_BYTES, tryLocally } from './mail'
import { applyRules, attachChosen, reviewCommands } from './review'
import { readerCommands, readerView } from './settings'

export const receiptCommands: Record<string, Command> = { ...readerCommands, ...mailCommands, ...reviewCommands }

const MEDIA = /^(application\/pdf|image\/(png|jpeg|webp|gif|heic|heif)|text\/plain|message\/rfc822)$/
const TARGETS = ['bankline', 'bill', 'payment', 'journal']

async function bytesOf(value: FormDataEntryValue | null, max: number, label: string) {
  if (!value || typeof value === 'string') return null
  requireThat(value.size > 0 && value.size <= max, `${label} is 1 byte to ${Math.round(max / 1_000_000)} MB`, 413)
  // Some browsers send a saved email or a PDF with no type; the file name says what it is.
  const byName = /\.eml$/i.test(value.name) ? 'message/rfc822' : /\.pdf$/i.test(value.name) ? 'application/pdf' : /\.jpe?g$/i.test(value.name) ? 'image/jpeg' : 'application/octet-stream'
  return { name: value.name || 'receipt', mediaType: value.type && value.type !== 'application/octet-stream' ? value.type : byName, bytes: new Uint8Array(await value.arrayBuffer()) }
}

export async function receiptsView(c: Context): Promise<Data> {
  const review = await all(c.db, `SELECT r.*, d.name AS file_name, d.media_type, d.size, d.sha256, f.name AS read_file_name, f.media_type AS read_media_type
    FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id LEFT JOIN pt_documents f ON f.id = r.file_document_id WHERE r.status = 'review' ORDER BY r.received_at DESC LIMIT 100`)
  for (const r of review) r.candidates = (await candidates(c.db, r.read_total_cents, r.read_date, r.read_vendor, r.read_currency)).slice(0, 6)
  const attached = await all(c.db, `SELECT r.id, r.vendor, r.receipt_date, r.total_cents, r.tax_cents, r.currency, r.source, r.target_kind, r.target_id, r.linked_kind, r.linked_id, r.rule_id, r.decided_by, r.decided_at, r.document_id, r.file_document_id, d.name AS file_name, d.media_type, d.sha256,
      CASE r.linked_kind WHEN 'bill' THEN (SELECT c.name || ' — bill ' || b.reference FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id WHERE b.id = r.linked_id)
        WHEN 'payment' THEN (SELECT 'Payment to ' || c.name FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id WHERE p.id = r.linked_id)
        WHEN 'journal' THEN (SELECT 'Entry ' || COALESCE(e.number, '') || ' · ' || e.memo FROM pt_journal_entries e WHERE e.id = r.linked_id) END AS linked_label
    FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id WHERE r.status = 'attached' ORDER BY r.decided_at DESC LIMIT 100`)
  const rules = await all(c.db, 'SELECT r.*, a.code, a.name AS account_name FROM pt_receipt_rules r JOIN pt_accounts a ON a.id = r.account_id WHERE r.active = 1 ORDER BY r.created_at')
  const reader = await readerView(c)
  return { review, attached, rules, accounts: await categories(c.db), reader: { unavailable: reader.unavailable, missing: reader.missing, model: reader.saved?.model ?? null }, inbox: await inboxView(c) }
}

export function receiptRoutes(api: Hono<{ Bindings: Bindings }>) {
  api.post('/api/pantry/receipts/capture', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'record')
    requireThat(Number(c.req.header('content-length') ?? 0) <= MAX_DOCUMENT_BYTES + 3_000_000, 'Files are up to 12 MB', 413)
    const form = await c.req.formData().catch(() => { throw new Fault(400, 'Send the file as a form upload') })
    const file = await bytesOf(form.get('file'), MAX_DOCUMENT_BYTES, 'The file')
    requireThat(file, 'Choose a photo or file')
    requireThat(MEDIA.test(file.mediaType), 'Upload a photo, a PDF or a saved email (.eml)')
    // A large or HEIC photo comes with a smaller JPEG made on the device, which is what the model reads.
    const copy = await bytesOf(form.get('copy'), 4_000_000, 'The reading copy')
    requireThat(!copy || copy.mediaType === 'image/jpeg', 'The reading copy is a JPEG')
    const source = form.get('source') === 'camera' ? 'camera' : 'upload'
    const targetKind = String(form.get('targetKind') ?? ''), targetId = String(form.get('targetId') ?? '')
    requireThat(!targetKind || (TARGETS.includes(targetKind) && targetId), 'Unknown transaction')
    const ctx: Context = { db: c.env.DB, env: c.env, request: c.req.raw, actor }
    const read = copy ? readable({ ...copy, name: file.name }) : file.mediaType === 'message/rfc822' ? emailReadable(file.bytes, file.name) : readable(file)
    const { id } = await receive(c.env.DB, c.env, { by: who(actor), source, original: file, file: copy ? { ...copy, name: `Reading copy of ${file.name}`, note: 'Smaller copy made on the device for reading' } : null, read, guards: [authority(actor, 'record')] })
    if (targetKind) await attachChosen(ctx, id, { kind: targetKind as any, id: targetId })
    else await applyRules(c.env.DB, id)
    return c.json({ id })
  })

  api.get('/api/pantry/receipts', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'read')
    return c.json(await receiptsView({ db: c.env.DB, env: c.env, request: c.req.raw, actor }))
  })

  // The transactions a receipt may belong to, from details a person typed (no AI key needed).
  api.get('/api/pantry/receipts/candidates', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'record')
    const q = c.req.query(), total = q.total ? cents(q.total, 'Total') : null
    const currency = optionalText(q.currency, 'Currency', 3).toUpperCase() || 'USD'
    return c.json({ candidates: (await candidates(c.env.DB, total, q.date ? date(q.date, 'Receipt date') : null, optionalText(q.vendor, 'Vendor', 200) || null, currency)).slice(0, 6) })
  })

  api.get('/api/pantry/receipts/settings', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'owner')
    const ctx = { db: c.env.DB, env: c.env, request: c.req.raw, actor }
    return c.json({ reader: await readerView(ctx), inbox: await inboxView(ctx) })
  })

  api.post('/api/pantry/receipts/try-email', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'owner')
    const file = await bytesOf((await c.req.formData()).get('message'), MAX_EMAIL_BYTES, 'The saved email')
    requireThat(file, 'Choose a saved email (.eml)')
    return c.json(await tryLocally(c.env, file.bytes))
  })
}
