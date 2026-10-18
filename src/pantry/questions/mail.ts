// Questions by email. Each question goes to the owner as one plain email: what
// doesn't add up, the numbered answers with what each changes, and a link that
// opens the exact record. A reply to the address the owner routed to this
// install comes back here: a number files that answer, a receipt attached to
// a receipt question is kept and attached, and other words are read by the
// install's model into an answer that waits for a "yes".
import { runtimeBindings, type Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
// @ts-expect-error Base's inbound MIME parser ships without type declarations.
import { parseMime as parseBaseMime } from '../../modules/mail/src/inbound/mime.mjs'
import { ownerEmail } from '../access'
import { now, uid, type Data } from '../core'
import { all, one, q, run } from '../db'
import { pantryAddress } from '../receipts/mail'
import { answer, confirm, hear, ownerByEmail, memberByEmail } from './answer'
import { AGENT, OPEN, parse, say, type Question } from './store'

type MailResult = { status: 'accepted' | 'rejected' | 'rate_limited' | 'uncertain' | 'development'; provider: string; providerMessageId: string | null; code?: string }
type Mailer = { send(message: Data): Promise<MailResult> }

/** Whether this install can email questions: 'ready', 'local' (this computer sends none) or 'none'. */
export function mailState(env: Bindings): 'ready' | 'local' | 'none' {
  const e = runtimeBindings(env), mailer = operatorMail(e)
  return !mailer ? 'none' : e.MAIL_PROVIDER === 'development' || e.RER_DEMO === '1' ? 'local' : 'ready'
}

export const questionLink = (env: Bindings, id: string) => `${runtimeBindings(env).AUTH_ORIGIN}/app/questions?q=${encodeURIComponent(id)}`
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const subjectRef = (ref: string) => `[Pantry ${ref}]`

async function sender(db: D1Database, env: Bindings) {
  const e = await one(db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
  const from = String(runtimeBindings(env).MAIL_FROM ?? '').trim(), address = from.replace(/^.*<([^>]+)>.*$/, '$1')
  const name = `${String(e?.legal_name ?? '').replace(/[<>"\\,;:@()[\]]/g, '').trim()} books`.trim()
  return { from: address ? `${name.length > 6 ? name : 'Pantry books'} <${address}>` : '', business: e?.legal_name ?? 'your business' }
}

/** Send one message about a question and say how it went. */
async function deliver(env: Bindings, db: D1Database, to: string, subject: string, text: string, html: string): Promise<{ status: 'sent' | 'local' | 'no-mail' | 'failed'; detail: string }> {
  const mailer = operatorMail(runtimeBindings(env)) as unknown as Mailer | undefined
  if (!mailer) return { status: 'no-mail', detail: 'No mail provider is set up for this installation, so Pantry asks in the app only.' }
  const s = await sender(db, env), replyTo = await pantryAddress(db, env)
  if (!s.from) return { status: 'no-mail', detail: 'MAIL_FROM is not set for this installation, so Pantry asks in the app only.' }
  try {
    const result = await mailer.send({ deliveryId: uid(), from: s.from, to: [to], subject, text, html, ...(replyTo ? { replyTo } : {}) })
    if (result.status === 'development') return { status: 'local', detail: 'This computer sends no email; the question waits here in Pantry.' }
    return result.status === 'accepted' || result.status === 'uncertain' ? { status: 'sent', detail: result.providerMessageId ?? '' } : { status: 'failed', detail: `The mail provider answered ${result.status}${result.code ? ` (${result.code})` : ''}.` }
  } catch (error) {
    const code = (error as Error)?.name === 'MailValidationError' ? (error as Data).code : null
    return { status: 'failed', detail: code ? `The message was refused before sending (${code}).` : 'The mail provider could not be reached.' }
  }
}

function questionBody(qn: Question, link: string, replies: boolean, business: string) {
  const choices = qn.choices.map((c, i) => `${i + 1}. ${c.label}\n   ${c.effect}${c.note ? ` Add a few words: ${c.note.toLowerCase()}.` : ''}`).join('\n')
  const how = qn.kind === 'accountant' ? (replies ? 'Reply with your answer; Pantry keeps it with this record.' : 'Open the link to answer in Pantry.') : qn.kind === 'missing-receipt'
    ? (replies ? 'Reply with the receipt attached and Pantry attaches it, or reply 1 and say why there is none.' : 'Open the link to upload it, or to say why there is none.')
    : replies ? `Reply with the number${qn.choices.some(c => c.learn) ? ' (add "always" to file the next ones from this payee the same way)' : ''}, or say in your own words what it was.` : 'Open the link to answer.'
  const facts = Object.entries(qn.facts).map(([k, v]) => `${k}: ${v}`).join('\n')
  const text = `${qn.question}\n\n${qn.why}\n\n${facts}\n\n${choices ? `${choices}\n\n` : ''}${how}\n\nOpen it in Pantry: ${link}\n\nNothing changes in the books for ${business} until you answer.\n`
  const html = `<p><strong>${escapeHtml(qn.question)}</strong></p><p>${escapeHtml(qn.why)}</p>` +
    `<table cellpadding="4">${Object.entries(qn.facts).map(([k, v]) => `<tr><td style="color:#5a6178">${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`).join('')}</table>` +
    (qn.choices.length ? `<ol>${qn.choices.map(c => `<li><strong>${escapeHtml(c.label)}</strong><br><span style="color:#4f5670">${escapeHtml(c.effect)}</span></li>`).join('')}</ol>` : '') +
    `<p>${escapeHtml(how)}</p><p><a href="${escapeHtml(link)}">Open it in Pantry</a></p><p style="color:#5a6178">Nothing changes in the books for ${escapeHtml(business)} until you answer.</p>`
  return { text, html }
}

/** Email one question to the owner and record the outcome on it. */
export async function emailQuestion(env: Bindings, db: D1Database, qn: Question) {
  const to = qn.assignee || await ownerEmail(db, env), s = await sender(db, env)
  const { text, html } = questionBody(qn, questionLink(env, qn.id), !!await pantryAddress(db, env), s.business)
  const sent = to ? await deliver(env, db, to, `${qn.question.length <= 90 ? qn.question : qn.title} ${subjectRef(qn.ref)}`, text, html) : { status: 'no-mail' as const, detail: 'The owner has no email address.' }
  await run(db, [q('UPDATE pt_questions SET email_status = ?, emailed_at = ?, emailed_to = ?, email_detail = ? WHERE id = ?', sent.status, sent.status === 'sent' ? now() : null, to || null, sent.detail, qn.id),
    ...(sent.status === 'sent' ? [say(qn.id, AGENT.email, 'agent', `Emailed this question to ${to}.`)] : [])])
  return sent.status
}

/** After a reply Pantry read from the owner's words: what it understood, and how to say yes. */
async function emailConfirmation(env: Bindings, db: D1Database, qn: Question, message: string) {
  const to = qn.assignee || await ownerEmail(db, env), link = questionLink(env, qn.id)
  const text = `${message}\n\nReply YES to do it, or NO to leave it as it is. Or open it in Pantry: ${link}\n`
  await deliver(env, db, to, `Re: ${qn.question.length <= 90 ? qn.question : qn.title} ${subjectRef(qn.ref)}`, text, `<p>${escapeHtml(message)}</p><p>Reply <strong>YES</strong> to do it, or <strong>NO</strong> to leave it as it is.</p><p><a href="${escapeHtml(link)}">Open it in Pantry</a></p>`)
}

type Parsed = { from: string | null; subject: string; text: string | null; html: string | null; attachments: { filename: string; contentType: string; content: Uint8Array }[] }
const MAX_REPLY_BYTES = 12_000_000
const LIMITS = { maxRawBytes: MAX_REPLY_BYTES, maxBodyBytes: 2_000_000, maxAttachments: 20, maxAttachmentBytes: MAX_REPLY_BYTES, maxTotalAttachmentBytes: MAX_REPLY_BYTES }
const parseMime = parseBaseMime as (bytes: Uint8Array, limits: typeof LIMITS, envelope?: { from: string; to: string }) => Parsed

const stripHtml = (html: string) => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<blockquote[\s\S]*$/i, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/** The words the owner typed, without the quoted question below them. */
export function replyText(m: { text: string | null; html: string | null }) {
  const body = (m.text ?? (m.html ? stripHtml(m.html) : '')).replace(/\r\n/g, '\n')
  const kept: string[] = []
  for (const line of body.split('\n')) {
    if (/^\s*>/.test(line) || /^On .+wrote:\s*$/.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim()) || /^_{5,}/.test(line.trim()) || /^From: .+/.test(line.trim())) break
    kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const RECEIPT = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/
export type ReplyOutcome = { result: 'not-mine' } | { result: 'refused'; reason: string } | { result: 'filed' | 'answered' | 'confirm' | 'unclear' | 'declined'; question: string }

/** One message delivered to the Pantry address (receipts/mail.ts asks here first). Anything without a question reference is not a reply. */
export async function receiveReply(env: Bindings, raw: Uint8Array): Promise<ReplyOutcome> {
  const db = env.DB
  let m: Parsed
  try { m = parseMime(raw, LIMITS) } catch { return { result: 'not-mine' } }
  const ref = /\[Pantry ([A-Z2-9]{10})\]/.exec(m.subject ?? '')?.[1]
  if (!ref) return { result: 'not-mine' }
  const row = await one(db, 'SELECT * FROM pt_questions WHERE ref = ?', ref)
  if (!row) return { result: 'not-mine' }
  const qn = parse(row), owner = await ownerEmail(db, env), from = String(m.from ?? '').toLowerCase()
  const recipient = qn.assignee || owner
  if (!from || from !== recipient || (qn.emailed_to && from !== qn.emailed_to)) return { result: 'refused', reason: 'Only the question’s recipient answers by email' }
  const by = qn.assignee ? await memberByEmail(db, from) : ownerByEmail(owner), words = replyText(m)
  if (!by) return { result: 'refused', reason: 'The accountant no longer has access to these books' }
  if (qn.kind === 'accountant' && OPEN.includes(qn.status) && words) { await hear(env, db, qn.id, words, by); return { result: 'answered', question: qn.id } }
  if (!OPEN.includes(qn.status)) {
    await run(db, [say(qn.id, by.audit.email, 'email', words || '(an empty reply)'), say(qn.id, AGENT.email, 'agent', 'This question was already settled, so the reply changed nothing.')])
    return { result: 'answered', question: qn.id }
  }
  const file = qn.kind === 'missing-receipt' ? m.attachments.find(a => RECEIPT.test(a.contentType) && a.content.length <= 1_500_000) : null
  if (file) { await answer(env, db, qn.id, { document: { name: file.filename || 'receipt', mediaType: file.contentType, bytes: file.content }, note: words.slice(0, 500) }, by); return { result: 'filed', question: qn.id } }
  if (qn.status === 'confirm' && /^(yes|y|yep|yeah|ok|okay|sure|do it|file it|approve)\b/i.test(words)) {
    const done = await confirm(env, db, qn.id, true, by)
    return { result: done.status === 'filed' ? 'filed' : 'answered', question: qn.id }
  }
  if (qn.status === 'confirm' && /^(no|nope|not now|leave it)\b/i.test(words)) { await confirm(env, db, qn.id, false, by); return { result: 'declined', question: qn.id } }
  const numbered = /^(\d{1,2})\b[.):]?\s*([\s\S]*)$/.exec(words)
  if (numbered) {
    const choice = qn.choices[Number(numbered[1]) - 1], rest = numbered[2].trim()
    if (choice) {
      const remember = /\balways\b|\bfrom now on\b|\bevery time\b/i.test(rest)
      const note = rest.replace(/\balways\b|\bfrom now on\b|\bevery time\b/gi, '').replace(/^[\s,.;:—-]+/, '').trim()
      if (choice.action.type !== 'no-receipt' || note) {
        const done = await answer(env, db, qn.id, { choice: choice.id, remember, note, words }, by)
        return { result: done.status === 'filed' ? 'filed' : 'answered', question: qn.id }
      }
    }
  }
  if (!words) {
    await run(db, [say(qn.id, by.audit.email, 'email', '(an empty reply)'), say(qn.id, AGENT.email, 'agent', 'The reply had no answer in it; the question is still open.')])
    return { result: 'unclear', question: qn.id }
  }
  const heard = await hear(env, db, qn.id, words, by)
  if (heard.result === 'confirm') await emailConfirmation(env, db, heard.question, heard.message)
  return { result: heard.result, question: qn.id }
}

/** Questions emailed today, to keep to the owner's daily limit. */
export async function emailedToday(db: D1Database) {
  return Number((await one(db, "SELECT COUNT(*) AS n FROM pt_questions WHERE email_status = 'sent' AND emailed_at >= ?", new Date().toISOString().slice(0, 10)))?.n ?? 0)
}

export async function waitingForEmail(db: D1Database) {
  return (await all(db, "SELECT * FROM pt_questions WHERE status = 'open' AND email_status IN ('', 'failed') ORDER BY asked_at, record_date LIMIT 20")).map(parse)
}
