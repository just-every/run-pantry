// Receipts over HTTP: the capture upload (multipart, so a phone photo arrives
// as its own bytes), the review view, and the local stand-in for delivered mail.
import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { authority, must, person, who } from '../access'
import { cents, date, Fault, optionalText, requireThat, type Data } from '../core'
import { all } from '../db'
import { MAX_DOCUMENT_BYTES } from '../documents'
import type { Command, Context } from '../context'
import { candidates, matchFacts } from './matches'
import { documentDuplicates } from './document-intake'
import { categories, readable, receive, receipt } from './intake'
import { duplicateDetails, duplicateOf, readFingerprint } from './duplicates'
import { emailReadable, inboxView, mailCommands, MAX_EMAIL_BYTES, tryLocally } from './mail'
import { applyRules, attachChosen, reviewCommands } from './review'
import { readerCommands, readerView } from './settings'
import { cashReceiptCommands } from './cash'
import { captureDraftCommands } from './drafts'
import { requiresOwner } from './draft-approval'
import { documentDraftProposal } from './draft-proposal'
import { receiptVendorCommands } from './vendor-confirm'
import { receiptVendorProposal } from './vendor-match'
import { bytesOf, MEDIA } from './upload'
import { chaseCommands, chaseView } from './chase'
import { captureRoutes, captureProvenance } from './captures'

export const receiptCommands: Record<string, Command> = { ...chaseCommands, ...cashReceiptCommands, ...readerCommands, ...mailCommands, ...reviewCommands, ...receiptVendorCommands, ...captureDraftCommands }

const TARGETS = ['bankline', 'bill', 'payment', 'journal']

// A deliberate Keep both may attach to the original's transaction, which the
// ordinary matching list omits because it already has its receipt.
function offerOriginal(list: Data[], original: Data | null, facts: { date: string | null; total: number | null }) {
  if (original?.target_id && !list.some(x => x.kind === original.target_kind && x.id === original.target_id)) {
    list.unshift({ kind: original.target_kind, id: original.target_id, date: facts.date ?? original.receipt_date, amount_cents: facts.total ?? original.total_cents, label: original.vendor, detail: 'Original receipt’s transaction', record: false })
  }
  return list
}

export async function receiptsView(c: Context): Promise<Data> {
  const review = await all(c.db, `SELECT r.*, d.name AS file_name, d.media_type, d.size, d.sha256, f.name AS read_file_name, f.media_type AS read_media_type
    FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id LEFT JOIN pt_documents f ON f.id = r.file_document_id WHERE r.status = 'review' AND r.mail_state = 'accepted' ORDER BY r.received_at DESC LIMIT 100`)
  for (const r of review) {
    const duplicate = await duplicateOf(c.db, r.id, readFingerprint(r))
    r.duplicate_of = duplicate?.receipt_id ?? null
    r.duplicate_document_id = duplicate?.document_id ?? null
    r.duplicate_basis = duplicate?.basis ?? null
    r.duplicate = await duplicateDetails(c.db, r.duplicate_document_id)
    // Identical bytes can reuse the first copy's accepted facts as editable
    // form defaults, even when this installation has no reading provider.
    if (r.duplicate && r.duplicate_basis === 'file') {
      r.vendor ??= r.read_vendor ?? r.duplicate.saved_vendor
      r.invoice_number ??= r.read_invoice_number ?? r.duplicate.invoice_number
      r.receipt_date ??= r.read_date ?? r.duplicate.receipt_date
      r.total_cents ??= r.read_total_cents ?? r.duplicate.total_cents
      r.tax_cents ??= r.read_tax_cents ?? r.duplicate.tax_cents
      r.currency ??= r.read_currency ?? r.duplicate.currency
      r.account_id ??= r.read_account_id ?? r.duplicate.account_id
    }
    r.vendorProposal = await receiptVendorProposal(c.db, r)
    r.account_id ??= r.vendorProposal.defaults?.accountId
    r.draftProposal = await documentDraftProposal(c.db, r)
    if (r.draftProposal.saved) r.draftProposal.saved.ownerRequired = await requiresOwner(c.db, r.draftProposal.saved.payload)
    r.candidates = (await candidates(c.db, r.total_cents ?? r.read_total_cents, r.receipt_date ?? r.read_date, r.vendor ?? r.read_vendor, r.currency ?? r.read_currency, matchFacts(r))).slice(0, 6)
    offerOriginal(r.candidates, r.duplicate, readFingerprint(r))
  }
  const attached = await all(c.db, `SELECT r.id, r.vendor, r.receipt_date, r.total_cents, r.tax_cents, r.currency, r.source, r.target_kind, r.target_id, r.linked_kind, r.linked_id, r.rule_id, r.decided_by, r.decided_at, r.document_id, r.file_document_id, r.duplicate_of, r.duplicate_document_id, r.invoice_number, r.duplicate_reason, d.name AS file_name, d.media_type, d.sha256,
      CASE r.linked_kind WHEN 'bill' THEN (SELECT c.name || ' — bill ' || b.reference FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id WHERE b.id = r.linked_id)
        WHEN 'payment' THEN (SELECT 'Payment to ' || c.name FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id WHERE p.id = r.linked_id)
        WHEN 'journal' THEN (SELECT 'Entry ' || COALESCE(e.number, '') || ' · ' || e.memo FROM pt_journal_entries e WHERE e.id = r.linked_id) END AS linked_label
    FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id WHERE r.status = 'attached' ORDER BY r.decided_at DESC LIMIT 100`)
  const skipped = await all(c.db, `SELECT r.id, r.source, r.decided_at, r.duplicate_of, r.duplicate_document_id, d.name AS file_name,
      COALESCE(original.document_id, od.id) AS original_document_id, original.decided_at AS original_attached_at, od.name AS original_file_name, od.media_type AS original_media_type
    FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id
      LEFT JOIN pt_receipts original ON original.id = r.duplicate_of
      JOIN pt_documents od ON od.id = COALESCE(original.document_id, r.duplicate_document_id)
    WHERE r.status = 'dismissed' ORDER BY r.decided_at DESC LIMIT 100`)
  await captureProvenance(c.db, [...review, ...attached, ...skipped])
  const rules = await all(c.db, 'SELECT r.*, a.code, a.name AS account_name FROM pt_receipt_rules r JOIN pt_accounts a ON a.id = r.account_id WHERE r.active = 1 ORDER BY r.created_at')
  const reader = await readerView(c)
  const quarantine = await all(c.db, `SELECT r.id, r.sender, r.subject, r.revision, r.document_id, r.file_document_id, r.mail_auth, d.name AS file_name FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id WHERE r.mail_state = 'quarantined' ORDER BY r.received_at DESC LIMIT 100`)
  return { quarantine, approvalRules: await all(c.db, 'SELECT * FROM pt_capture_approval_rules ORDER BY minimum_cents'), review, attached, skipped, duplicateDocuments: await documentDuplicates(c.db), rules, accounts: await categories(c.db), reader: { unavailable: reader.unavailable, missing: reader.missing, model: reader.saved?.model ?? null }, inbox: await inboxView(c) }
}

export function receiptRoutes(api: Hono<{ Bindings: Bindings }>) {
  captureRoutes(api)
  api.post('/api/pantry/receipts/capture', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'record')
    requireThat(Number(c.req.header('content-length') ?? 0) <= MAX_DOCUMENT_BYTES + 4_100_000, 'Files are up to 25 MB, plus a reading copy', 413)
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
    const captured = (await receipt(c.env.DB, id))!
    return c.json({ id, duplicate: await duplicateDetails(c.env.DB, captured.duplicate_document_id ?? captured.duplicate_of) })
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
    const facts = { vendor: optionalText(q.vendor, 'Vendor', 200) || null, invoiceNumber: optionalText(q.invoiceNumber, 'Invoice number', 80) || null, date: q.date ? date(q.date, 'Receipt date') : null, total }
    const r = q.id ? await receipt(c.env.DB, optionalText(q.id, 'Receipt', 80)) : null
    const duplicate = r?.status === 'review' ? await duplicateOf(c.env.DB, r.id, facts) : null
    const original = await duplicateDetails(c.env.DB, duplicate?.document_id ?? null)
    const found = (await candidates(c.env.DB, facts.total, facts.date, facts.vendor, currency, { tip: q.tip ? cents(q.tip, 'Tip', { zero: true }) : null, chargedUsd: q.chargedUsd ? cents(q.chargedUsd, 'USD charge') : null, cardLast4: /^\d{4}$/.test(q.cardLast4 ?? '') ? q.cardLast4 : null })).slice(0, 6)
    return c.json({ candidates: offerOriginal(found, original, facts), duplicate: original, duplicateBasis: duplicate?.basis ?? null })
  })

  api.get('/api/pantry/receipts/settings', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'owner')
    const ctx = { db: c.env.DB, env: c.env, request: c.req.raw, actor }
    return c.json({ reader: await readerView(ctx), inbox: await inboxView(ctx), chase: await chaseView(c.env.DB) })
  })

  api.post('/api/pantry/receipts/try-email', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'owner')
    const file = await bytesOf((await c.req.formData()).get('message'), MAX_EMAIL_BYTES, 'The saved email')
    requireThat(file, 'Choose a saved email (.eml)')
    return c.json(await tryLocally(c.env, file.bytes))
  })
}
