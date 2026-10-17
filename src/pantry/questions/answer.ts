// Answering a question. A chosen answer is the owner's yes to the change it
// names: Pantry files the transaction (a category, an invoice or bill payment,
// a transfer), attaches the receipt or keeps the reason, and, when the owner
// says so, makes a bank rule so the next ones file themselves. Words the owner
// wrote are read by the install's model into one of those answers and wait for
// a yes. Nothing is ever filed without the owner's answer.
import type { Bindings } from '../../auth.server'
import { authority, who, type Person } from '../access'
import { now, optionalText, requireThat, text, uid } from '../core'
import { all, audit, changed, guard, one, q, run, type AuditActor, type Sql } from '../db'
import { documentInsert } from '../contacts'
import { matchInput, matchPlan } from '../matching'
import { applyRules, newRuleStatements, payeeKey } from '../rules'
import { categoryEffect, NetIncome, type Choice } from './checks'
import { modelState, ModelError, readAnswer } from './model'
import { AGENT, OPEN, question, say, type Question } from './store'

/** Who answered and the authority their write carries: a signed-in person, or the owner by email. */
export type Answerer = { person: Person; audit: AuditActor; authority: (need: 'record' | 'post') => Sql; via: 'app' | 'email' }

export const personAnswerer = (p: Person): Answerer => ({ person: p, audit: who(p), authority: need => authority(p, need), via: 'app' })

/** The owner answering by email: their write needs them still to be this install's active owner. */
export const ownerByEmail = (email: string): Answerer => ({
  person: { kind: 'person', id: '', email, name: '', session: '', role: 'owner', grants: { post: true, lock: true, reopen: true } },
  audit: { email, kind: 'person' },
  authority: () => guard("EXISTS (SELECT 1 FROM oa_operators WHERE lower(email) = ? AND role = 'owner' AND status = 'active')", email),
  via: 'email',
})

export type Answer = { choice?: string | null; accountId?: string | null; remember?: boolean; note?: string; document?: { name: string; mediaType: string; bytes: Uint8Array } | null; words?: string }

/** The question's offered answer, or a category the owner picked for a transaction ("something else"). */
async function chosen(db: D1Database, qn: Question, a: Answer): Promise<Choice> {
  if (a.choice) {
    const c = qn.choices.find(x => x.id === a.choice)
    requireThat(c, 'That answer is not one of this question’s answers')
    return c
  }
  requireThat(a.accountId && qn.subject_kind === 'bank-line' && (qn.kind === 'unfiled' || qn.kind === 'unmatched-deposit'), 'Choose one of the answers')
  const account = await one(db, 'SELECT * FROM pt_accounts WHERE id = ?', a.accountId)
  requireThat(account && account.active && !['bank', 'receivable', 'payable', 'retained'].includes(account.subtype), 'Choose an income, expense or equity category')
  return { id: `account:${account.id}`, label: `${account.code} ${account.name}`, effect: await categoryEffect(new NetIncome(db), account, qn.amount_cents, qn.period), action: { type: 'category', accountId: account.id }, learn: true }
}

const settle = (qn: Question, status: string, by: Answerer, answer: string, result: { kind?: string; id?: string; rule?: string } = {}): Sql[] => [
  q(`UPDATE pt_questions SET status = ?, answer = ?, answered_by = ?, answered_via = ?, answered_at = ?, pending = NULL, result_kind = ?, result_id = ?, rule_id = ?, revision = ? WHERE id = ? AND revision = ? AND status IN ('open', 'confirm')`,
    status, answer.slice(0, 1000), by.audit.email, by.via, now(), result.kind ?? null, result.id ?? null, result.rule ?? null, uid(), qn.id, qn.revision), changed(),
]

/** File the bank line the way the answer says: one match with the new entry or payment it needs. */
async function fileLine(db: D1Database, qn: Question, c: Choice, by: Answerer) {
  const line = await one(db, 'SELECT * FROM pt_bank_lines WHERE id = ?', qn.subject_id)
  requireThat(line && !line.removed_at, 'The bank removed this transaction', 409)
  const abs = Math.abs(line.amount_cents), amount = (abs / 100).toFixed(2), into = line.amount_cents > 0, a = c.action
  if (a.type === 'posting') return matchPlan(db, by.person, { ...matchInput({ bankLineIds: [line.id], journalLineIds: [a.journalLineId], note: `Answer to Pantry's question: ${c.label}` }), proposalId: null })
  const item = a.type === 'category' ? { type: into ? 'income' : 'fee', amount, accountId: a.accountId, direction: into ? 'in' : 'out', memo: line.description }
    : a.type === 'invoice' ? { type: 'receipt', amount, contactId: a.contactId, date: line.posted_date, reference: line.reference, allocations: [{ targetId: a.invoiceId, amount }] }
    : a.type === 'bill' ? { type: 'payment', amount, contactId: a.contactId, date: line.posted_date, reference: line.reference, allocations: [{ targetId: a.billId, amount }] }
    : a.type === 'transfer' ? { type: 'transfer', amount, otherBankAccountId: a.otherBankAccountId, direction: into ? 'in' : 'out', memo: line.description } : null
  requireThat(item, 'This answer does not file a transaction')
  return matchPlan(db, by.person, { ...matchInput({ bankLineIds: [line.id], create: [item], note: `Answer to Pantry's question: ${c.label}` }), proposalId: null })
}

/** A rule for this payee and direction filing to the chosen category, then every open line it matches. */
async function learn(db: D1Database, qn: Question, accountId: string, by: Answerer) {
  const line = (await one(db, 'SELECT * FROM pt_bank_lines WHERE id = ?', qn.subject_id))!, key = payeeKey(line)
  if (!key) return null
  const account = (await one(db, 'SELECT name FROM pt_accounts WHERE id = ?', accountId))!
  const payee = key.toLowerCase().replace(/\b[a-z]/g, ch => ch.toUpperCase())
  const rule = await newRuleStatements(db, { name: `${payee} → ${account.name}`.slice(0, 120), payee, direction: line.amount_cents < 0 ? 'out' : 'in', splits: [{ accountId, percent: '100' }] }, by.audit)
  await run(db, [by.authority('record'), ...rule.statements, q('UPDATE pt_questions SET rule_id = ? WHERE id = ?', rule.id, qn.id),
    say(qn.id, AGENT.email, 'agent', `Learned: a bank rule now files ${payee} ${line.amount_cents < 0 ? 'payments' : 'deposits'} to ${account.name}. Undo any filing, or retire the rule, in Bank → Rules.`)])
  const open = await all(db, `SELECT l.id FROM pt_bank_lines l WHERE l.removed_at IS NULL AND l.rules_off = 0 AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines m WHERE m.bank_line_id = l.id AND m.active = 1)`)
  const filed = await applyRules(db, open.map(l => l.id), () => ({ actor: by.audit, authority: by.authority('record') }))
  return { id: rule.id, filed: filed.filed }
}

/** Apply a definite answer. Returns the question as it now stands. */
export async function answer(env: Bindings, db: D1Database, id: string, a: Answer, by: Answerer): Promise<Question> {
  const qn = await question(db, id)
  requireThat(OPEN.includes(qn.status), qn.status === 'resolved' ? 'This no longer needs an answer' : 'This question is already answered', 409)
  const note = optionalText(a.note, 'Note', 500)
  // A receipt sent for a cost without one: kept byte for byte and attached to the record.
  if (a.document) {
    requireThat(qn.kind === 'missing-receipt', 'Only a question about a receipt takes a file')
    const doc = await documentInsert({ actor: by.audit }, { ...a.document, linkedKind: qn.subject_kind, linkedId: qn.subject_id, note: `Sent in answer to Pantry's question${by.via === 'email' ? ' by email' : ''}` })
    await run(db, [by.authority('record'), doc.statement, ...settle(qn, 'filed', by, `Sent the receipt (${a.document.name})${note ? `: ${note}` : ''}`, { kind: 'document', id: doc.id }),
      say(qn.id, by.audit.email, by.via, `Sent ${a.document.name}${note ? ` — ${note}` : ''}`), say(qn.id, AGENT.email, 'agent', `Attached ${a.document.name} to the ${qn.subject_kind === 'bill' ? 'bill' : 'entry'}.`),
      audit(by.audit, 'question.answer', 'question', qn.id, { kind: qn.kind, via: by.via, document: doc.id, sha256: doc.sha256 })])
    return question(db, id)
  }
  const c = await chosen(db, qn, a)
  const said = `${c.label}${note ? ` — ${note}` : ''}`
  const base = (status: string, result: { kind?: string; id?: string } = {}) => [...settle(qn, status, by, said, result), say(qn.id, by.audit.email, by.via, a.words ? `${a.words}` : said)]
  switch (c.action.type) {
    case 'category': case 'invoice': case 'bill': case 'transfer': case 'posting': {
      const plan = await fileLine(db, qn, c, by)
      await run(db, [by.authority('record'), ...plan.statements, ...base('filed', { kind: 'match', id: plan.id }), say(qn.id, AGENT.email, 'agent', `Filed: ${c.effect}`),
        audit(by.audit, 'question.answer', 'question', qn.id, { kind: qn.kind, via: by.via, answer: c.label, match: plan.id })])
      if (a.remember && c.action.type === 'category' && c.learn) await learn(db, qn, c.action.accountId, by)
      break
    }
    case 'no-receipt': {
      requireThat(note, 'Say in a few words why there is no receipt')
      // Recording why there is no receipt is the same act as waiving it on the bill or entry, which needs the posting grant.
      requireThat(by.person.role === 'owner' || by.person.grants.post, 'Recording why there is no receipt needs the posting grant', 403)
      if (qn.subject_kind === 'bill') {
        await run(db, [by.authority('post'), q('UPDATE pt_bills SET evidence_waived = ?, revision = ? WHERE id = ? AND evidence_waived IS NULL', `${note} — ${by.audit.email}`, uid(), qn.subject_id), changed(),
          ...base('filed', { kind: 'bill', id: qn.subject_id }), say(qn.id, AGENT.email, 'agent', 'Recorded your reason on the bill.'), audit(by.audit, 'bill.evidence-waived', 'bill', qn.subject_id, { reason: note, question: qn.id })])
      } else await run(db, [by.authority('post'), q('INSERT INTO pt_receipt_waivers (entry_id, reason, waived_by, waived_at) VALUES (?, ?, ?, ?)', qn.subject_id, note.slice(0, 300), by.audit.email, now()),
        ...base('filed', { kind: 'journal', id: qn.subject_id }), say(qn.id, AGENT.email, 'agent', 'Recorded your reason on the entry: no receipt needed.'), audit(by.audit, 'receipt.not-needed', 'journal', qn.subject_id, { reason: note, question: qn.id })])
      break
    }
    case 'note': await run(db, [by.authority('record'), ...base('answered'), audit(by.audit, 'question.answer', 'question', qn.id, { kind: qn.kind, via: by.via, answer: c.label })]); break
    case 'dismiss': await run(db, [by.authority('record'), ...base('dismissed'), say(qn.id, AGENT.email, 'agent', 'Understood; Pantry will not ask about this again.'), audit(by.audit, 'question.dismiss', 'question', qn.id, { kind: qn.kind, via: by.via })]); break
  }
  return question(db, id)
}

export type Heard = { result: 'filed' | 'confirm' | 'unclear'; question: Question; message: string }

/**
 * Words the owner wrote, in the app or in a reply. The install's model reads
 * them into one of the question's answers, which then waits for the owner's
 * yes. Without a model the words are kept in the thread and the question stays
 * open for the owner to choose.
 */
export async function hear(env: Bindings, db: D1Database, id: string, words: string, by: Answerer): Promise<Heard> {
  const qn = await question(db, id), said = text(words, 'Your answer', 4000)
  requireThat(OPEN.includes(qn.status), 'This question is already answered', 409)
  const model = await modelState(db, env)
  const unclear = async (message: string) => {
    await run(db, [by.authority('record'), q("UPDATE pt_questions SET status = 'open', pending = NULL, revision = ? WHERE id = ? AND revision = ?", uid(), qn.id, qn.revision), changed(),
      say(qn.id, by.audit.email, by.via, said), say(qn.id, AGENT.email, 'agent', message)])
    return { result: 'unclear' as const, question: await question(db, id), message }
  }
  if (!('config' in model)) return unclear(`Pantry keeps your words, but reads answers in your own words only with an AI model (${'unavailable' in model ? model.unavailable : model.missing}) Choose one of the answers, or a category.`)
  const accounts = await all(db, 'SELECT * FROM pt_accounts ORDER BY code')
  let read
  try { read = await readAnswer(model.config, qn, qn.choices, accounts, said) }
  catch (e) { return unclear(`Pantry could not read your answer: ${e instanceof ModelError ? e.message : 'the AI model failed.'} Choose one of the answers instead.`) }
  if (!read.understood) return unclear(`Pantry could not tell what it was${read.note ? ` (${read.note})` : ''}. Choose one of the answers, or say what the money was for.`)
  const c = await chosen(db, qn, { choice: read.choice, accountId: read.accountId })
  const pending = { choice: read.choice, accountId: read.accountId, remember: read.remember && !!c.learn, note: read.note, read: said, label: c.label, effect: c.effect }
  const message = `I read that as: ${c.label}. ${c.effect}${pending.remember ? ' And from now on, the same for this payee.' : ''} Nothing changes until you say yes.`
  await run(db, [by.authority('record'), q("UPDATE pt_questions SET status = 'confirm', pending = ?, revision = ? WHERE id = ? AND revision = ?", JSON.stringify(pending), uid(), qn.id, qn.revision), changed(),
    say(qn.id, by.audit.email, by.via, said), say(qn.id, AGENT.email, 'agent', message), audit(AGENT, 'question.read', 'question', qn.id, { via: by.via, read: c.label })])
  return { result: 'confirm', question: await question(db, id), message }
}

/** The owner's yes (or no) to an answer read from their words. */
export async function confirm(env: Bindings, db: D1Database, id: string, yes: boolean, by: Answerer): Promise<Question> {
  const qn = await question(db, id)
  requireThat(qn.status === 'confirm' && qn.pending, 'There is nothing waiting for your yes on this question', 409)
  if (!yes) {
    await run(db, [by.authority('record'), q("UPDATE pt_questions SET status = 'open', pending = NULL, revision = ? WHERE id = ? AND revision = ?", uid(), qn.id, qn.revision), changed(),
      say(qn.id, by.audit.email, by.via, 'Not that.'), say(qn.id, AGENT.email, 'agent', 'Understood; nothing changed. Choose an answer, or tell Pantry in other words.')])
    return question(db, id)
  }
  const p = qn.pending
  return answer(env, db, id, { choice: p.choice, accountId: p.accountId, remember: p.remember, note: p.note, words: by.via === 'email' ? 'Yes' : undefined }, by)
}
