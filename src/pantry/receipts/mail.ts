// The Pantry address. The owner routes one mailbox on their own domain to this
// Worker with Cloudflare Email Routing and enters it here; Pantry adds a private
// random tag. Mail to mailbox+tag@domain (a rule for the mailbox, Subaddressing
// on) or to mailbox-tag@domain (a rule for that exact address, for a domain
// without Subaddressing) is kept; anything else is refused unread. Each kept message is
// kept whole, byte for byte, and read from its PDF or photo attachment, or from
// its text when it has none.
import type { Bindings } from '../../auth.server'
// @ts-expect-error Base's inbound MIME parser ships without type declarations.
import { parseMime as parseBaseMime } from '../../modules/mail/src/inbound/mime.mjs'
import { authority, who } from '../access'
import { now, requireThat, text, uid, type Data } from '../core'
import { audit, one, q, run } from '../db'
import type { Command, Context } from '../context'
import { seal, unseal } from '../seal'
import { MAX_IMAGE_TO_READ, receive } from './intake'
import type { ReceiptInput } from './reader'
import { applyRules } from './review'
import { managed } from './settings'

const PURPOSE = 'receipt-address-tag'
export const MAX_EMAIL_BYTES = 12_000_000
const LIMITS = { maxRawBytes: MAX_EMAIL_BYTES, maxBodyBytes: 2_000_000, maxAttachments: 40, maxAttachmentBytes: MAX_EMAIL_BYTES, maxTotalAttachmentBytes: MAX_EMAIL_BYTES }

export function mailbox(value: unknown) {
  const m = /^([a-z0-9][a-z0-9._-]{0,40})@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/.exec(String(value ?? '').trim().toLowerCase())
  return m ? { local: m[1], domain: m[2] } : null
}
const format = (box: { local: string; domain: string }, tag: string) => `${box.local}+${tag}@${box.domain}`
/** The same private address for a domain without Subaddressing, routed by its own rule. */
const exact = (box: { local: string; domain: string }, tag: string) => `${box.local}-${tag}@${box.domain}`
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const newTag = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => ALPHABET[b % ALPHABET.length]).join('')

function sameText(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/**
 * Where this install can receive mail: here on this computer; nowhere, on RER
 * Managed hosting, which runs in RER's account with no domain of the owner's;
 * or through a domain in the Cloudflare account it runs in (its own address
 * may still be workers.dev, which cannot receive mail itself).
 */
export function hosting(env: Bindings): 'local' | 'no-domain' | 'domain' {
  if (env.AUTH_LOCAL === 'true') return 'local'
  return managed(env) ? 'no-domain' : 'domain'
}

async function liveAddress(db: D1Database, env: Bindings) {
  const row = await one(db, 'SELECT * FROM pt_receipt_inbox WHERE id = 1')
  const box = row ? mailbox(row.mailbox) : null
  const tag = row && box ? await unseal(env.SESSION_SECRET, PURPOSE, row.tag_sealed) : null
  return row && box && tag ? { row, address: format(box, tag), exactAddress: exact(box, tag) } : null
}

export async function inboxView(c: Context): Promise<Data> {
  const live = await liveAddress(c.db, c.env), row = live?.row ?? await one(c.db, 'SELECT mailbox FROM pt_receipt_inbox WHERE id = 1')
  return { hosting: hosting(c.env), host: new URL(c.env.AUTH_ORIGIN).hostname, mailbox: row?.mailbox ?? null, address: live?.address ?? null, exactAddress: live?.exactAddress ?? null,
    lastReceivedAt: live?.row.last_received_at ?? null, lastNote: live?.row.last_note ?? '', confirmation: live?.row.confirmation ? JSON.parse(live.row.confirmation) : null }
}

/** Creates the address, or replaces it: the old one stops reaching Pantry at once. */
const createAddress: Command = { need: 'owner', async run(c, b) {
  requireThat(hosting(c.env) !== 'no-domain', 'Forwarding receipts by email needs a domain of your own; RER Managed hosting does not have one yet', 409)
  const raw = text(b.mailbox, 'Receiving address', 120).toLowerCase(), box = mailbox(raw)
  requireThat(box && !raw.includes('+'), 'Enter the address you routed to Pantry, like receipts@example.com (without a +tag)')
  const tag = await seal(c.env.SESSION_SECRET, PURPOSE, newTag())
  await run(c.db, [authority(c.actor, 'owner'),
    q("INSERT INTO pt_receipt_inbox (id, mailbox, tag_sealed, created_by, created_at, last_note, confirmation, revision) VALUES (1, ?, ?, ?, ?, '', '', ?) ON CONFLICT(id) DO UPDATE SET mailbox = excluded.mailbox, tag_sealed = excluded.tag_sealed, created_by = excluded.created_by, created_at = excluded.created_at, last_received_at = NULL, last_note = '', confirmation = '', revision = excluded.revision",
      raw, tag, c.actor.email, now(), uid()),
    audit(who(c.actor), 'receipt-address.create', 'settings', 'receipt-address', { mailbox: raw })])
  return inboxView(c)
} }

const removeAddress: Command = { need: 'owner', async run(c) {
  await run(c.db, [authority(c.actor, 'owner'), q('DELETE FROM pt_receipt_inbox WHERE id = 1'), audit(who(c.actor), 'receipt-address.remove', 'settings', 'receipt-address')])
  return inboxView(c)
} }

export const mailCommands: Record<string, Command> = {
  'receipt-address.create': createAddress,
  'receipt-address.remove': removeAddress,
}

const stripHtml = (html: string) => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#36;|&dollar;/g, '$').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()

type Parsed = { from: string | null; subject: string; text: string | null; html: string | null; attachments: { filename: string; contentType: string; content: Uint8Array }[] }
const parseMime = parseBaseMime as (bytes: Uint8Array, limits: typeof LIMITS, envelope?: { from: string; to: string }) => Parsed

/** The attachment to read, if the message has a PDF or photo. */
function receiptAttachment(m: Parsed) {
  return m.attachments.find(a => a.contentType === 'application/pdf') ?? m.attachments.find(a => /^image\/(png|jpeg|webp|gif)$/.test(a.contentType) && a.content.length >= 10_000 && a.content.length <= MAX_IMAGE_TO_READ) ?? null
}

/** The message as a person reads it: the HTML version carries the receipt when the plain part is only a note. */
function emailText(m: Parsed) {
  const html = m.html ? stripHtml(m.html) : '', text = m.text?.trim() ?? ''
  // Usually the two parts say the same thing; send one. A long note beside a short HTML part keeps both.
  const body = !html ? text : html.length >= text.length * 0.6 ? html : `${text}\n\n${html}`
  return `From: ${m.from ?? ''}\nSubject: ${m.subject ?? ''}\n\n${body}`
}

const UNREADABLE = 'Pantry could not read this email’s format; it is kept as received.'

/** What the model reads from an email: its PDF or photo, else its text. */
function readFrom(m: Parsed, name: string): ReceiptInput {
  const a = receiptAttachment(m)
  if (!a) return { kind: 'text', text: emailText(m), name }
  return { kind: a.contentType === 'application/pdf' ? 'pdf' : 'image', mediaType: a.contentType, bytes: a.content, name: a.filename || name }
}

/** The same, from a stored email's bytes. */
export function emailReadable(bytes: Uint8Array, name: string): ReceiptInput | string {
  try { return readFrom(parseMime(bytes, LIMITS, undefined), name) } catch { return UNREADABLE }
}

/** Gmail and Google Workspace confirm a new forwarding address with a code; the owner needs to see it. */
function forwardingConfirmation(m: Parsed) {
  if (!/forwarding-noreply@google\.com$/i.test(m.from ?? '') || !/forwarding confirmation/i.test(m.subject ?? '')) return null
  const body = m.text ?? stripHtml(m.html ?? '')
  return { code: /#(\d{6,12})/.exec(m.subject ?? '')?.[1] ?? /confirmation code:\s*(\d{6,12})/i.exec(body)?.[1] ?? null,
    link: /https:\/\/(?:mail-settings|mail|isolated\.mail)\.google\.com\/mail\/vf-[^\s<>"')]+/.exec(body)?.[0] ?? null,
    account: /receive mail from\s+([^\s]+@[^\s]+)/i.exec(m.subject ?? '')?.[1]?.toLowerCase() ?? null, receivedAt: now() }
}

const fileName = (subject: string) => `${(subject || 'email').replace(/[^\w .-]+/g, '').trim().slice(0, 80) || 'email'}.eml`

export type MailOutcome = { result: 'refused'; reason: string } | { result: 'confirmation' } | { result: 'received'; receiptId: string; read: string; rule: string | null }

/** One message delivered to the Pantry address (or a saved .eml sent to it on this computer). */
export async function receiveMail(env: Bindings, recipients: string[], raw: Uint8Array, envelopeFrom?: string): Promise<MailOutcome> {
  const db = env.DB, live = await liveAddress(db, env)
  const ours = (r: string) => { const a = (/<([^<>]+)>/.exec(r)?.[1] ?? r).trim().toLowerCase(); return !!live && (sameText(a, live.address) || sameText(a, live.exactAddress)) }
  if (!live || !recipients.some(ours)) return { result: 'refused', reason: 'Unknown address' }
  let parsed: Parsed | null = null
  // The sender shown is the message's From; the envelope sender is often the provider's bounce address.
  try { parsed = parseMime(raw, LIMITS, undefined) } catch { parsed = null }
  const confirmation = parsed && forwardingConfirmation(parsed)
  if (confirmation) {
    await run(db, [q('UPDATE pt_receipt_inbox SET confirmation = ?, last_received_at = ?, last_note = ? WHERE id = 1', JSON.stringify(confirmation), now(), 'Gmail asked to confirm forwarding')])
    return { result: 'confirmation' }
  }
  const sender = parsed?.from ?? envelopeFrom ?? '', subject = parsed?.subject ?? ''
  const attachment = parsed ? receiptAttachment(parsed) : null
  const by = { email: `mail:${sender || 'unknown sender'}`.slice(0, 254), kind: 'person' as const }
  const { id, outcome } = await receive(db, env, {
    by, source: 'email', sender, subject,
    original: { name: fileName(subject), mediaType: 'message/rfc822', bytes: raw, note: `Emailed to the Pantry address by ${sender || 'an unknown sender'}` },
    file: attachment ? { name: attachment.filename || (attachment.contentType === 'application/pdf' ? 'receipt.pdf' : 'receipt-photo'), mediaType: attachment.contentType, bytes: attachment.content, note: `Attachment of ${fileName(subject)}` } : null,
    read: parsed ? readFrom(parsed, fileName(subject)) : UNREADABLE,
  })
  const rule = await applyRules(db, id)
  await run(db, [q('UPDATE pt_receipt_inbox SET last_received_at = ?, last_note = ? WHERE id = 1', now(), `${subject || 'A message'} from ${sender || 'an unknown sender'}`.slice(0, 300))])
  return { result: 'received', receiptId: id, read: outcome.status, rule }
}

/** Cloudflare Email Routing: the Worker's email handler. Anything not for the Pantry address is refused unread. */
export async function emailHandler(message: ForwardableEmailMessage, env: Bindings) {
  if (message.rawSize > MAX_EMAIL_BYTES) { message.setReject('Message too large for Pantry (12 MB)'); return }
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer())
  const outcome = await receiveMail(env, [message.to], raw, message.from)
  if (outcome.result === 'refused') message.setReject(outcome.reason)
}

/** On this computer no mail server can reach Pantry; a saved .eml goes through the same receiving code. */
export async function tryLocally(env: Bindings, raw: Uint8Array) {
  requireThat(hosting(env) === 'local', 'Not found', 404)
  const live = await liveAddress(env.DB, env)
  requireThat(live, 'Create your Pantry address first', 409)
  return receiveMail(env, [live.address], raw)
}
