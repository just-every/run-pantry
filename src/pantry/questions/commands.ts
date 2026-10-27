// The Questions page: the agent's questions and their threads, answering in
// the app, "Check now", and the owner's settings for how Pantry asks.
import { requireThat, text, now, uid, optionalText, cents, usd } from '../core'
import { authority, ownerEmail, who } from '../access'
import { all, audit, changed, q, run } from '../db'
import type { Command, Context } from '../context'
import { answer, confirm, hear, personAnswerer, questionEffects } from './answer'
import { hosting, pantryAddress } from '../receipts/mail'
import { mailState } from './mail'
import { modelState } from './model'
import { runAgent } from './run'
import { questionRecipients } from './recipients'
import { accountantCommands } from './accountant'
import { agentSettings, parse, withThreads } from './store'

export async function agentView(c: Context) {
  const s = await agentSettings(c.db), model = await modelState(c.db, c.env)
  return {
    settings: { emailOn: !!s.email_on, perDay: s.per_day, depositDays: s.deposit_days, fileDays: s.file_days, receiptAmount: (s.receipt_cents / 100).toFixed(2), revision: s.revision, updatedBy: s.updated_by, updatedAt: s.updated_at },
    lastRun: s.last_run_at ? s.last_run : null,
    mail: mailState(c.env), owner: await ownerEmail(c.db, c.env),
    // Replies come back to the Pantry address; this computer and RER Managed have none that mail can reach.
    hosting: hosting(c.env), replyTo: await pantryAddress(c.db, c.env),
    model: 'config' in model ? { on: true, line: `Reading answers in your own words with ${model.config.model}.` } : { on: false, line: 'unavailable' in model ? model.unavailable : `Checking with built-in rules only. ${model.missing.replace('read receipts', 'let Pantry read answers in your own words and guess categories')}` },
  }
}

export async function questionsView(c: Context, focus?: string) {
  const open = await all(c.db, "SELECT * FROM pt_questions WHERE status IN ('open', 'confirm') ORDER BY record_date, asked_at, id")
  const settled = await all(c.db, "SELECT * FROM pt_questions WHERE status NOT IN ('open', 'confirm') ORDER BY COALESCE(answered_at, asked_at) DESC, id LIMIT 100")
  const extra = focus && ![...open, ...settled].some(r => r.id === focus) ? await all(c.db, 'SELECT * FROM pt_questions WHERE id = ?', focus) : []
  return { recipients: await questionRecipients(c.db), open: await withThreads(c.db, open.map(parse)), settled: await withThreads(c.db, [...extra, ...settled].map(parse)), agent: await agentView(c) }
}

const answerCommand: Command = { need: 'record', async run(c, b) {
  const by = personAnswerer(c.actor as any)
  if (typeof b.words === 'string' && b.words.trim()) return { heard: await hear(c.env, c.db, text(b.id, 'Question'), b.words, by) }
  return { question: await answer(c.env, c.db, text(b.id, 'Question'), { choice: b.choice ? text(b.choice, 'Answer') : null, accountId: b.accountId ? text(b.accountId, 'Category') : null, remember: b.remember === true || b.remember === 'on', note: optionalText(b.note, 'Note', 500), date: b.date, previewToken: b.previewToken }, by) }
} }

const previewCommand: Command = { need: 'record', async run(c, b) {
  return { effects: await questionEffects(c.db, text(b.id, 'Question'), { choice: b.choice, accountId: b.accountId, remember: b.remember === true, note: optionalText(b.note, 'Note', 500), date: b.date }, personAnswerer(c.actor as any)) }
} }

const confirmCommand: Command = { need: 'record', async run(c, b) {
  return { question: await confirm(c.env, c.db, text(b.id, 'Question'), b.yes === true, personAnswerer(c.actor as any)) }
} }

/** A receipt uploaded in answer to a receipt question. */
const receiptCommand: Command = { need: 'record', async run(c, b) {
  const name = text(b.name, 'File name', 200), mediaType = text(b.mediaType, 'File type', 100)
  requireThat(/^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(mediaType), 'Upload the receipt as a PDF or a photo')
  requireThat(typeof b.base64 === 'string' && /^[A-Za-z0-9+/]+=*$/.test(b.base64), 'File content is missing')
  const bytes = Uint8Array.from(atob(b.base64), ch => ch.charCodeAt(0))
  return { question: await answer(c.env, c.db, text(b.id, 'Question'), { document: { name, mediaType, bytes }, note: optionalText(b.note, 'Note', 500) }, personAnswerer(c.actor as any)) }
} }

const runCommand: Command = { need: 'record', async run(c) {
  await run(c.db, [authority(c.actor, 'record')])
  return { run: await runAgent(c.env), ...(await questionsView(c)) }
} }

const saveSettings: Command = { need: 'owner', async run(c, b) {
  const s = await agentSettings(c.db)
  requireThat(b.revision === s.revision, 'These settings changed; reload', 409)
  const whole = (v: unknown, label: string, min: number, max: number) => { const n = Number(v); requireThat(Number.isInteger(n) && n >= min && n <= max, `${label} is a whole number from ${min} to ${max}`); return n }
  const fields = { emailOn: b.emailOn === true || b.emailOn === 'on', perDay: whole(b.perDay, 'Questions a day', 1, 20), depositDays: whole(b.depositDays, 'Days before asking about a deposit', 0, 90), fileDays: whole(b.fileDays, 'Days before asking about an unfiled transaction', 0, 120), receipt: cents(b.receiptAmount, 'Receipt threshold', { zero: true }) }
  await run(c.db, [authority(c.actor, 'owner'),
    q('UPDATE pt_books_agent SET email_on = ?, per_day = ?, deposit_days = ?, file_days = ?, receipt_cents = ?, updated_by = ?, updated_at = ?, revision = ? WHERE id = 1 AND revision = ?',
      fields.emailOn ? 1 : 0, fields.perDay, fields.depositDays, fields.fileDays, fields.receipt, c.actor.email, now(), uid(), s.revision), changed(),
    audit(who(c.actor), 'books-agent.settings', 'books-agent', '1', { emailOn: fields.emailOn, perDay: fields.perDay, depositDays: fields.depositDays, fileDays: fields.fileDays, receipt: usd(fields.receipt) })])
  return agentView(c)
} }

export const questionCommands: Record<string, Command> = {
  ...accountantCommands,
  'question.answer': answerCommand,
  'question.preview': previewCommand,
  'question.confirm': confirmCommand,
  'question.receipt': receiptCommand,
  'books-agent.run': runCommand,
  'books-agent.save': saveSettings,
}

