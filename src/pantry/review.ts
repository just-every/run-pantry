import { DIMENSIONS, dimensionTags, dimensionRefusal } from './dimensions'
// Accountant review tools: bulk reclassification by linked correcting entries,
// review notes on entries, and everything changed since a reviewer's last
// review with who changed it. Originals never change: each selected line is
// moved by its own posted correcting entry, dated on the original's date, so
// only open months can be corrected this way.
import { nativeApprovalAuthority } from './access-policy/approvals'
import { ledgerBankAuthority } from './access-policy/banks'
import { authority, who } from './access'
import { list, now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, approval, assertOpen, audit, guard, one, periodOpen, q, run, type Sql } from './db'
import { entryStatements, type Line } from './journal'
import type { Command } from './context'
import { writeOffBatches, writeOffLimit } from './write-offs'

const MOVABLE = "subtype = 'other'"
const MAX_LINES = 200

const reclassify: Command = { need: 'post', async run(c, b) {
  const ids = [...new Set(list<string>(b.lineIds, 'Lines to reclassify', MAX_LINES).map(id => text(id, 'Line')))]
  requireThat(ids.length, 'Choose the lines to reclassify')
  const dimension=b.dimensionKind?text(b.dimensionKind,'Dimension kind'):null
  requireThat(!dimension||DIMENSIONS.includes(dimension as any),'Choose class, location or project')
  const target=dimension?text(b.toDimensionName,'New dimension',100):null
  if(dimension)requireThat(await one(c.db,'SELECT 1 FROM pt_dimensions WHERE kind=? AND name=? AND active=1',dimension,target),'Choose an active dimension value')
  const to = dimension?null:await one(c.db, `SELECT * FROM pt_accounts WHERE id = ? AND active = 1 AND ${MOVABLE}`, text(b.toAccountId, 'Reclassify to'))
  requireThat(dimension||to, 'Reclassify to an active ordinary account (not bank, receivable, payable, sales tax or retained earnings)')
  const reason = optionalText(b.memo, 'Reason', 300)
  const lines = await all(c.db, `SELECT l.*, e.number, e.entry_date, e.status, e.reversed_by_id, e.source_kind, a.code AS account_code, a.name AS account_name, a.subtype,
      (SELECT 1 FROM pt_reclassifications r WHERE r.original_line_id = l.id) AS moved
    FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id
    WHERE l.id IN (${ids.map(() => '?').join(',')})`, ...ids)
  requireThat(lines.length === ids.length, 'A chosen line was not found', 404)
  for (const l of lines) {
    const label = `Entry ${l.number ?? 'draft'} line ${l.line_no}`
    requireThat(!dimension || !['invoice','credit','bill'].includes(l.source_kind), `${label} needs a document correction so cash recognition follows its settlements`, 409)
    requireThat(l.status === 'posted', `${label} is a draft; edit the draft instead`, 409)
    requireThat(!l.reversed_by_id && l.source_kind !== 'reversal', `${label} is reversed or is a reversal; it cannot be reclassified`, 409)
    requireThat(!l.moved, `${label} was already reclassified; reclassify its correcting entry instead`, 409)
    requireThat(l.subtype === 'other', `${label} is on ${l.account_name}, a bank, control, sales tax or retained-earnings account; record a correction there instead`, 409)
    requireThat(dimension?l[`${dimension}_name`]!==target:l.account_id !== to!.id, `${label} already has the destination coding`)
    await assertOpen(c.db, l.entry_date)
  }
  const batch = uid(), statements: Sql[] = [authority(c.actor, 'post'), ...await ledgerBankAuthority(c.db, c.actor, [...(to?[to.id]:[]), ...lines.map(l => l.account_id)], 'post')]
  for (const l of lines) {
    const id = uid(), revision = uid(), amount = l.debit_cents || l.credit_cents, debit = l.debit_cents > 0
    const destination=dimension?{...dimensionTags(l),[`${dimension}Name`]:target}:dimensionTags(l)
    const refusal=await dimensionRefusal(c.db,[to?.id??l.account_id],destination);requireThat(!refusal,refusal??'Invalid dimensions',409)
    const moved: Line[] = [
      { ...destination,accountId: to?.id??l.account_id, debit: debit ? amount : 0, credit: debit ? 0 : amount, memo: l.memo, contactId: l.contact_id },
      { ...dimensionTags(l),accountId: l.account_id, debit: debit ? 0 : amount, credit: debit ? amount : 0, memo: l.memo, contactId: l.contact_id },
    ]
    statements.push(...nativeApprovalAuthority(c.actor, 'journal', amount), periodOpen(l.entry_date), guard("EXISTS (SELECT 1 FROM pt_journal_entries WHERE id = ? AND status = 'posted' AND reversed_by_id IS NULL)", l.entry_id),
      ...entryStatements({ id, revision, date: l.entry_date, memo: `Reclassify entry ${l.number} line ${l.line_no}: ${l.account_code} ${l.account_name} → ${dimension?`${dimension} ${target}`:`${to!.code} ${to!.name}`} ${reason ? ` — ${reason}` : ''}`,
        sourceKind: 'manual', sourceId: l.entry_id, preparedBy: c.actor.email, preparedKind: 'person', lines: moved }, c.actor.email),
      q('INSERT INTO pt_reclassifications (id, batch_id, original_entry_id, original_line_id, correcting_entry_id, from_account_id, to_account_id, amount_cents, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        uid(), batch, l.entry_id, l.id, id, l.account_id, to?.id??l.account_id, amount, c.actor.email, now()),
      approval(who(c.actor), 'journal', id, revision, 'reclassify', 'approved', reason))
  }
  statements.push(audit(who(c.actor), 'journal.reclassify', 'reclassification', batch, { to: `${dimension?`${dimension} ${target}`:`${to!.code} ${to!.name}`} `, lines: lines.length, reason }))
  await run(c.db, statements)
  return { batch, reclassified: await all(c.db, 'SELECT * FROM pt_reclassifications WHERE batch_id = ? ORDER BY created_at, id', batch) }
} }

const note: Command = { need: 'record', async run(c, b) {
  const entry = await one(c.db, 'SELECT id FROM pt_journal_entries WHERE id = ?', text(b.entryId, 'Entry'))
  requireThat(entry, 'Journal entry not found', 404)
  const id = uid(), body = text(b.note, 'Review note', 2000)
  await run(c.db, [authority(c.actor, 'record'), q('INSERT INTO pt_review_notes (id, entry_id, note, author, created_at) VALUES (?, ?, ?, ?, ?)', id, entry.id, body, c.actor.email, now()),
    audit(who(c.actor), 'journal.review-note', 'journal', entry.id, { note: body })])
  return { notes: await notes(c.db, entry.id) }
} }

/** A reviewer marks the books reviewed now; later changes by anyone appear on their list. */
const mark: Command = { need: 'read', async run(c) {
  requireThat(c.actor.kind === 'person', 'A person marks their review', 403)
  await run(c.db, [authority(c.actor, 'read'), q('INSERT INTO pt_review_marks (id, reviewer, reviewed_at) VALUES (?, ?, ?)', uid(), c.actor.email, now())])
  return reviewView(c.db, c.actor.email)
} }

export const notes = (db: D1Database, entryId: string) => all(db, 'SELECT * FROM pt_review_notes WHERE entry_id = ? ORDER BY created_at, id', entryId)

/** What changed since `reviewer` last marked their review (everything, before a first review), newest first. */
export async function reviewView(db: D1Database, reviewer: string) {
  const last = await one(db, 'SELECT reviewed_at FROM pt_review_marks WHERE reviewer = ? ORDER BY reviewed_at DESC LIMIT 1', reviewer)
  const since = last?.reviewed_at ?? ''
  const changes = await all(db, `SELECT a.id, a.at, a.actor_email, a.actor_kind, a.action, a.subject_kind, a.subject_id, a.detail,
      CASE WHEN a.subject_kind = 'journal' THEN (SELECT e.number FROM pt_journal_entries e WHERE e.id = a.subject_id) END AS entry_number,
      CASE WHEN a.subject_kind = 'journal' THEN (SELECT e.memo FROM pt_journal_entries e WHERE e.id = a.subject_id) END AS entry_memo
    FROM pt_audit a WHERE a.at > ? ORDER BY a.at DESC, a.rowid DESC LIMIT 300`, since)
  const recent = await all(db, `SELECT n.*, e.number, e.memo FROM pt_review_notes n JOIN pt_journal_entries e ON e.id = n.entry_id ORDER BY n.created_at DESC LIMIT 100`)
  const batches = await all(db, `SELECT r.batch_id, MIN(r.created_at) AS created_at, r.created_by, COUNT(*) AS lines, SUM(r.amount_cents) AS amount_cents, t.code AS to_code, t.name AS to_name
    FROM pt_reclassifications r JOIN pt_accounts t ON t.id = r.to_account_id GROUP BY r.batch_id ORDER BY created_at DESC LIMIT 50`)
  return { reviewer, reviewedAt: last?.reviewed_at ?? null, changes: changes.map((e): Data => ({ ...e, detail: JSON.parse(e.detail) })), notes: recent, reclassifications: batches, writeOffs: await writeOffBatches(db), writeOffLimit: await writeOffLimit(db) }
}

export const reviewCommands: Record<string, Command> = { 'journal.reclassify': reclassify, 'journal.review-note': note, 'review.mark': mark }
