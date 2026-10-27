// Person-to-accountant questions share the agent's durable thread and close checks.
import { authority, who } from '../access'
import type { Command } from '../context'
import { now, requireThat, text, uid, usd } from '../core'
import { all, audit, changed, one, periodOpen, q, run } from '../db'
import { recordView } from '../records'
import { reportSource } from './report-source'
import { emailQuestion } from './mail'
import { questionRecipients, recipientLive } from './recipients'
import { newRef, OPEN, question, say } from './store'

export const accountants = (db: D1Database) => all(db, "SELECT email, name FROM pt_members WHERE active = 1 AND role = 'accountant' ORDER BY name, email")
async function assignee(db: D1Database, value: unknown) {
  const email = text(value, 'Mention a person', 255).replace(/^@/, '').toLowerCase()
  requireThat((await questionRecipients(db)).some(a => a.email === email), 'Choose an active owner, bookkeeper or accountant with full, unmasked access to the books')
  return email
}

async function source(db: D1Database, kind: string, id: string) {
  if (kind === 'report-line') {
    const d = await reportSource(db, id)
    return { date: d.to, amount: d.figure, title: d.label, facts: { Report: d.report, Figure: d.label, From: d.from, Through: d.to, Basis: d.basis, Amount: usd(d.figure) } }
  }
  if (kind === 'bank-line') {
    const r = await one(db, 'SELECT l.*, b.name FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id WHERE l.id = ?', id)
    requireThat(r, 'Bank transaction not found', 404)
    return { date: r.posted_date, amount: r.amount_cents, title: r.description, facts: { Account: r.name, Transaction: r.description, Date: r.posted_date, Amount: usd(r.amount_cents) } }
  }
  const d = await recordView(db, kind === 'journal' ? 'entry' : kind, id)
  return { date: d.date, amount: d.total, title: d.title, facts: { Record: d.title, Date: d.date, Amount: usd(d.total) } }
}

const ask: Command = { need: 'record', async run(c, b) {
  const kind = text(b.subjectKind, 'Record type', 40), subjectId = text(b.subjectId, 'Record', 2000), words = text(b.question, 'Your question', 2000)
  const to = await assignee(c.db, b.assignee), s = await source(c.db, kind, subjectId), id = uid()
  await run(c.db, [authority(c.actor, 'record'), recipientLive(to), periodOpen(s.date),
    q(`INSERT INTO pt_questions (id, kind, fingerprint, subject_kind, subject_id, period, record_date, amount_cents, title, question, why, facts, choices, status, ref, asked_at, revision, assignee)
      VALUES (?, 'accountant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'open', ?, ?, ?, ?)`, id, `person:${id}`, kind, subjectId, s.date.slice(0, 7), s.date, s.amount, s.title, words, `Asked by ${c.actor.email}; waiting for ${to}.`, JSON.stringify(s.facts), newRef(), now(), uid(), to),
    say(id, c.actor.email, 'app', words), audit(who(c.actor), 'question.ask', kind, subjectId, { question: id, assignee: to })])
  await emailQuestion(c.env, c.db, await question(c.db, id))
  return { question: await question(c.db, id) }
} }

const assign: Command = { need: 'record', async run(c, b) {
  const qn = await question(c.db, text(b.id, 'Question')), to = await assignee(c.db, b.assignee)
  requireThat(OPEN.includes(qn.status), 'This question is already answered', 409)
  await run(c.db, [authority(c.actor, 'record'), recipientLive(to),
    q("UPDATE pt_questions SET assignee = ?, email_status = '', emailed_to = NULL, emailed_at = NULL, revision = ? WHERE id = ? AND revision = ?", to, uid(), qn.id, qn.revision), changed(),
    say(qn.id, c.actor.email, 'app', `Asked ${to} to answer.`), audit(who(c.actor), 'question.assign', 'question', qn.id, { assignee: to })])
  await emailQuestion(c.env, c.db, await question(c.db, qn.id))
  return { question: await question(c.db, qn.id) }
} }

export const accountantCommands = { 'question.ask': ask, 'question.assign': assign }
