import { runStanding } from '../standing'
import { discoverLearning } from '../learning'
// One pass of the books agent: find what doesn't add up, ask each new thing
// once, let go of questions the books have since answered for themselves, and
// email the owner the new ones, a few a day. Cron runs it about hourly; a
// person can run it from the Questions page. It only reads the books and
// writes questions: filing waits for the owner's answer.
import type { Bindings } from '../../auth.server'
import { longDay, now, uid, type Data } from '../core'
import { all, one, q, run, type Sql } from '../db'
import { categoryEffect, findIssues, NetIncome, type Choice, type Issue } from './checks'
import { emailedToday, emailQuestion, waitingForEmail } from './mail'
import { modelState, suggestCategory } from './model'
import { AGENT, agentSettings, newRef, OPEN, parse, say, type Question } from './store'

const HOURLY = 55 * 60 * 1000

/** Why a question no longer needs an answer, in the owner's words. */
async function settledBy(db: D1Database, qn: Question): Promise<string> {
  if (qn.subject_kind === 'bank-line') {
    const line = await one(db, `SELECT l.removed_at, m.approved_by, m.approved_at, r.name AS rule FROM pt_bank_lines l LEFT JOIN pt_match_bank_lines mb ON mb.bank_line_id = l.id AND mb.active = 1
      LEFT JOIN pt_matches m ON m.id = mb.match_id LEFT JOIN pt_bank_rules r ON r.id = m.rule_id WHERE l.id = ?`, qn.subject_id)
    if (line?.removed_at) return 'The bank removed this transaction.'
    if (line?.approved_by) return `Filed${line.rule ? ` by the rule ${line.rule}` : ''} by ${line.approved_by} on ${longDay(String(line.approved_at).slice(0, 10))}.`
  }
  if (qn.kind === 'missing-receipt') {
    const doc = await one(db, 'SELECT name, uploaded_by FROM pt_documents WHERE linked_kind = ? AND linked_id = ? ORDER BY uploaded_at DESC LIMIT 1', qn.subject_kind, qn.subject_id)
    if (doc) return `${doc.name} was attached by ${doc.uploaded_by}.`
    if (qn.subject_kind === 'bill' && (await one(db, 'SELECT evidence_waived FROM pt_bills WHERE id = ?', qn.subject_id))?.evidence_waived) return 'A reason for the missing receipt was recorded on the bill.'
    const waiver = qn.subject_kind === 'journal' ? await one(db, 'SELECT waived_by FROM pt_receipt_waivers WHERE entry_id = ?', qn.subject_id) : null
    if (waiver) return `${waiver.waived_by} recorded that no receipt is needed.`
    if (qn.subject_kind === 'journal') return 'The receipt is now attached to the entry or its record.'
  }
  if (qn.kind === 'balance-mismatch') return 'The bank balance and the books now agree, or a newer statement replaced this one.'
  return 'The books no longer show this.'
}

/** For a line nothing explains, the install's model may add its best guess at a category. */
async function withGuess(env: Bindings, db: D1Database, issue: Issue, accounts: Data[], budget: { left: number }): Promise<Choice[]> {
  if (!issue.line || budget.left <= 0 || issue.choices.some(c => c.from === 'history')) return issue.choices
  const model = await modelState(db, env)
  if (!('config' in model)) return issue.choices
  budget.left--
  try {
    const code = await suggestCategory(model.config, issue.line, accounts)
    const account = code ? accounts.find(a => a.code === code) : null
    if (!account || issue.choices.some(c => c.id === `account:${account.id}`)) return issue.choices
    const guess: Choice = { id: `account:${account.id}`, label: `${account.name} (Pantry's guess)`, effect: await categoryEffect(new NetIncome(db), account, issue.amount, issue.period), action: { type: 'category', accountId: account.id }, learn: true, from: 'guess' }
    // The guess goes after any invoice, bill or transfer match; the usual categories make room for it.
    const list = [...issue.choices.filter(c => c.action.type !== 'category'), guess, ...issue.choices.filter(c => c.action.type === 'category')]
    while (list.length > 4 && list.some(c => c.from === 'usual')) list.splice(list.findLastIndex(c => c.from === 'usual'), 1)
    return list.slice(0, 4)
  } catch { return issue.choices }
}

export type RunResult = { at: string; found: number; asked: number; reopened: number; resolved: number; emailed: number; open: number; model: string; mail: string }

/** One pass. Scheduled runs keep to about once an hour; a person's "Check now" always runs. */
export async function runAgent(env: Bindings, { scheduled = false } = {}): Promise<RunResult | null> {
  const db = env.DB
  if (!await one(db, 'SELECT 1 FROM pt_entity WHERE id = 1')) return null
  const settings = await agentSettings(db), at = now()
  if (scheduled) {
    const claimed = await db.prepare('UPDATE pt_books_agent SET last_run_at = ? WHERE id = 1 AND (last_run_at IS NULL OR last_run_at < ?)').bind(at, new Date(Date.now() - HOURLY).toISOString()).run()
    if (claimed.meta.changes !== 1) return null
  }
  await runStanding(db)
  const issues = await findIssues(db, settings, at.slice(0, 10))
  const known = new Map((await all(db, 'SELECT * FROM pt_questions')).map(r => [r.fingerprint, parse(r)]))
  const accounts = await all(db, 'SELECT * FROM pt_accounts ORDER BY code'), budget = { left: 5 }
  const writes: Sql[] = []
  let asked = 0, reopened = 0, resolved = 0
  for (const issue of issues) {
    const existing = known.get(issue.fingerprint)
    if (!existing) {
      const id = uid(), choices = await withGuess(env, db, issue, accounts, budget)
      writes.push(q(`INSERT INTO pt_questions (id, kind, fingerprint, subject_kind, subject_id, period, record_date, amount_cents, title, question, why, facts, choices, status, ref, asked_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`, id, issue.kind, issue.fingerprint, issue.subjectKind, issue.subjectId, issue.period, issue.recordDate, issue.amount,
        issue.title, issue.question, issue.why, JSON.stringify(issue.facts), JSON.stringify(choices), newRef(), at, uid()),
        say(id, AGENT.email, 'agent', `${issue.question} ${issue.why}`))
      asked++
    } else if (existing.status === 'resolved') {
      // It came back (a filing undone, a receipt removed): the same question opens again.
      writes.push(q("UPDATE pt_questions SET status = 'open', facts = ?, revision = ? WHERE id = ? AND status = 'resolved'", JSON.stringify(issue.facts), uid(), existing.id),
        say(existing.id, AGENT.email, 'agent', `This needs an answer again: ${issue.why}`))
      reopened++
    }
  }
  const current = new Set(issues.map(i => i.fingerprint))
  for (const qn of known.values()) if (qn.kind !== 'accountant' && OPEN.includes(qn.status) && !current.has(qn.fingerprint)) {
    writes.push(q("UPDATE pt_questions SET status = 'resolved', pending = NULL, revision = ? WHERE id = ? AND revision = ?", uid(), qn.id, qn.revision), say(qn.id, AGENT.email, 'agent', `No answer needed any more: ${await settledBy(db, qn)}`))
    resolved++
  }
  for (let i = 0; i < writes.length; i += 80) await run(db, writes.slice(i, i + 80))

  // Email the oldest unasked ones, a few a day, by email first.
  let emailed = 0, mail = 'off'
  if (settings.email_on) {
    const room = Math.max(0, settings.per_day - await emailedToday(db))
    for (const qn of (await waitingForEmail(db)).slice(0, room)) {
      const status = await emailQuestion(env, db, qn)
      mail = status
      if (status === 'sent') emailed++
      else break
    }
    if (mail === 'off') mail = room ? 'nothing new' : 'daily limit reached'
  }
  const model = await modelState(db, env)
  const open = Number((await one(db, "SELECT COUNT(*) AS n FROM pt_questions WHERE status IN ('open', 'confirm')"))?.n ?? 0)
  const result: RunResult = { at, found: issues.length, asked, reopened, resolved, emailed, open, model: 'config' in model ? 'on' : 'unavailable' in model ? 'unavailable' : 'missing', mail }
  await run(db, [q('UPDATE pt_books_agent SET last_run_at = ?, last_run = ? WHERE id = 1', at, JSON.stringify(result)),
    ...(asked || resolved || reopened ? [q('INSERT INTO pt_audit (id, at, actor_email, actor_kind, action, subject_kind, subject_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', uid(), at, AGENT.email, AGENT.kind, 'books-agent.run', 'books-agent', '1', JSON.stringify({ asked, resolved, reopened, emailed }))] : [])])
  await discoverLearning(db)
  return result
}

/** The month's questions, every status, each with its thread: what the close shows. */
export async function periodQuestions(db: D1Database, period: string) {
  return (await all(db, 'SELECT * FROM pt_questions WHERE period = ? ORDER BY record_date, asked_at, id', period)).map(parse)
}
