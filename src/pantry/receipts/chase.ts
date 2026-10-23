// Owner-consented requests reuse the existing authenticated question and reply door.
import type { Bindings } from '../../auth.server'
import { authority, who } from '../access'
import type { Command } from '../context'
import { addDays, now, requireThat, text, uid, usd } from '../core'
import { all, audit, changed, guard, one, q, run } from '../db'
import { emailQuestion } from '../questions/mail'
import { memberByEmail, financialQuestionAllowed } from '../questions/answer'
import { agentSettings, newRef, parse } from '../questions/store'
import { missingReceipts } from './attachments'

async function eligible(db: D1Database, email: string) {
  if (await one(db, "SELECT 1 FROM oa_operators WHERE lower(email) = ? AND status = 'active' AND role = 'owner'", email)) return true
  const member = await memberByEmail(db, email)
  return !!member && financialQuestionAllowed(member)
}

export async function chaseView(db: D1Database) {
  const saved = await one(db, 'SELECT * FROM pt_receipt_chase WHERE id = 1')
  const active = saved?.owner_id && await one(db, "SELECT 1 FROM oa_operators WHERE id = ? AND role = 'owner' AND status = 'active'", saved.owner_id)
  return { settings: saved ? { ...saved, enabled: active ? saved.enabled : 0 } : { enabled: 0, repeat_days: 7, revision: 'initial' }, cardholders: await all(db, 'SELECT c.last_four, o.email FROM pt_receipt_cardholders c LEFT JOIN oa_operators o ON o.id = c.operator_id ORDER BY c.last_four') }
}

/** Prepare mapped questions before the ordinary question pass chooses recipients. */
export async function prepareReceiptRequests(db: D1Database, today: string) {
  const settings = await one(db, 'SELECT * FROM pt_receipt_chase WHERE id = 1')
  if (!settings?.enabled || !await one(db, "SELECT 1 FROM oa_operators WHERE id = ? AND role = 'owner' AND status = 'active'", settings.owner_id)) return []
  const agent = await agentSettings(db), before = addDays(today, -agent.file_days)
  const missing = (await missingReceipts(db, '0000-01-01', before)).filter(entry => entry.amount_cents > agent.receipt_cents)
  const ids: string[] = []
  for (const entry of missing) {
    if (await one(db, "SELECT 1 FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", entry.entry_date)) continue
    if (!await one(db, "SELECT 1 FROM pt_journal_lines l JOIN pt_accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND a.type = 'expense'", entry.id)) continue
    const owners = await all(db, `SELECT DISTINCT lower(o.email) AS email FROM pt_journal_lines l JOIN pt_bank_accounts b ON b.account_id = l.account_id JOIN pt_receipt_cardholders c ON c.last_four = b.number_last4 JOIN oa_operators o ON o.id = c.operator_id AND o.status = 'active' WHERE l.entry_id = ? AND l.credit_cents > 0`, entry.id)
    if (owners.length !== 1 || !await eligible(db, owners[0].email)) continue
    const fingerprint = `receipt:journal:${entry.id}`, existing = await one(db, 'SELECT * FROM pt_questions WHERE fingerprint = ?', fingerprint)
    if (existing && !['open', 'confirm'].includes(existing.status)) continue
    const email = owners[0].email
    if (!existing) {
      const id = uid()
      await run(db, [q(`INSERT OR IGNORE INTO pt_questions (id, kind, fingerprint, subject_kind, subject_id, period, record_date, amount_cents, title, question, why, facts, choices, status, ref, asked_at, revision, assignee, email_status) VALUES (?, 'missing-receipt', ?, 'journal', ?, ?, ?, ?, ?, ?, ?, '{}', ?, 'open', ?, ?, ?, ?, 'held')`, id, fingerprint, entry.id, entry.entry_date.slice(0, 7), entry.entry_date, -entry.amount_cents, `Receipt for ${entry.memo}`, `Do you have the receipt for ${usd(entry.amount_cents)} ${entry.memo}?`, 'The charge is filed without a receipt.', JSON.stringify([{ id: 'no-receipt', label: 'There is no receipt', effect: 'Records a reason with the posting grant.', action: { type: 'no-receipt' }, note: 'Why there is none' }]), newRef(), now(), uid(), email)])
    } else if (existing.assignee !== email) {
      // An unanswered question may be routed by explicit owner consent; stale email replies then fail.
      if (existing.status !== 'open') continue
      await run(db, [q("UPDATE pt_questions SET assignee = ?, email_status = 'held', emailed_at = NULL, emailed_to = NULL, revision = ? WHERE id = ? AND revision = ? AND status = 'open'", email, uid(), existing.id, existing.revision)])
    }
    const row = await one(db, 'SELECT id FROM pt_questions WHERE fingerprint = ?', fingerprint)
    if (row) ids.push(row.id)
  }
  return ids
}

export async function sendReceiptRequests(env: Bindings, db: D1Database, stamp = now()) {
  const ids = await prepareReceiptRequests(db, stamp.slice(0, 10)), settings = await one(db, 'SELECT * FROM pt_receipt_chase WHERE id = 1')
  let sent = 0
  for (const id of ids) {
    const row = await one(db, "SELECT * FROM pt_questions WHERE id = ? AND status = 'open'", id)
    if (!row || !await eligible(db, row.assignee)) continue
    if (row.emailed_at && Date.parse(stamp) - Date.parse(row.emailed_at) < settings!.repeat_days * 86_400_000) continue
    const prior = `${settings!.revision}:${row.assignee}:${row.emailed_at ?? Math.floor(Date.parse(stamp) / (settings!.repeat_days * 86_400_000))}`
    // Claim before the provider call. Concurrent Cron and Check now cannot send twice.
    const claim = await db.prepare(`INSERT OR IGNORE INTO pt_receipt_request_attempts (question_id, prior_email, attempted_at, outcome) SELECT ?, ?, ?, 'sending' WHERE EXISTS (SELECT 1 FROM pt_receipt_chase WHERE id = 1 AND enabled = 1 AND revision = ? AND owner_id IN (SELECT id FROM oa_operators WHERE role = 'owner' AND status = 'active')) AND EXISTS (SELECT 1 FROM pt_questions WHERE id = ? AND revision = ? AND status = 'open')`).bind(id, prior, stamp, settings!.revision, id, row.revision).run()
    if (claim.meta.changes !== 1) continue
    const result = await emailQuestion(env, db, parse(row))
    if (result !== 'sent') await run(db, [q("UPDATE pt_questions SET email_status = 'held' WHERE id = ? AND status = 'open'", id)])
    await run(db, [q('UPDATE pt_receipt_request_attempts SET outcome = ? WHERE question_id = ? AND prior_email = ?', result, id, prior), audit({ email: 'agent:pantry', kind: 'agent' }, 'receipt.request', 'journal', row.subject_id, { question: id, recipient: row.assignee, result })])
    if (result === 'sent') sent++
  }
  return { sent }
}

const save: Command = { need: 'owner', async run(c, b) {
  const repeatDays = Number(b.repeatDays)
  requireThat(Number.isInteger(repeatDays) && repeatDays >= 1 && repeatDays <= 90, 'Repeat reminders every 1–90 days')
  requireThat(b.enabled === false || b.enabled === true && b.consent === true, 'Confirm consent before enabling receipt request emails')
  const before = await chaseView(c.db)
  const statements = [authority(c.actor, 'owner'), guard("COALESCE((SELECT revision FROM pt_receipt_chase WHERE id = 1), 'initial') = ?", b.revision), q('INSERT INTO pt_receipt_chase (id, enabled, repeat_days, revision, owner_id) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, repeat_days = excluded.repeat_days, revision = excluded.revision, owner_id = excluded.owner_id', b.enabled ? 1 : 0, repeatDays, uid(), c.actor.kind === 'person' ? c.actor.id : ''), changed()]
  if (b.lastFour) {
    const lastFour = text(b.lastFour, 'Card last four'), email = text(b.email, 'Cardholder email').toLowerCase()
    requireThat(/^\d{4}$/.test(lastFour), 'Enter exactly four card digits')
    requireThat(await eligible(c.db, email), 'Choose the owner or an active accountant with full unmasked book access')
    const operator = await one(c.db, "SELECT id FROM oa_operators WHERE lower(email) = ? AND status = 'active'", email)
    requireThat(operator, 'Choose an active person in these books')
    statements.push(q('INSERT INTO pt_receipt_cardholders (last_four, operator_id) VALUES (?, ?) ON CONFLICT(last_four) DO UPDATE SET operator_id = excluded.operator_id', lastFour, operator.id))
  }
  statements.push(audit(who(c.actor), 'receipt-chase.settings', 'settings', 'receipt-chase', { before, enabled: b.enabled, repeatDays, lastFour: b.lastFour || null, email: b.email || null, consent: b.consent === true }))
  await run(c.db, statements)
  return chaseView(c.db)
} }

export const chaseCommands: Record<string, Command> = {
  'receipt-chase.save': save,
  'receipt-chase.run': { need: 'owner', async run(c) { return sendReceiptRequests(c.env, c.db) } },
}
