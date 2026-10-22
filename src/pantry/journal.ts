// The general journal: every posting in Pantry is a balanced entry written here.
// Drafts may change; posted entries are immutable (the schema's triggers refuse
// edits) and are corrected only by a linked reversal.
import { nativeApprovalAuthority } from './access-policy/approvals'
import { bankAuthority, ledgerBankAuthority } from './access-policy/banks'
import { authority, who, type Actor } from './access'
import { cents, date, now, optionalText, requireThat, text, uid, list, type Data } from './core'
import { all, approval, assertOpen, audit, changed, guard, one, q, run, type AuditActor, type Sql } from './db'
import type { Command } from './context'
import { entryDocuments } from './receipts/attachments'
import { reverseEarlyDiscounts } from './early-payment'

export type Line = { accountId: string; debit: number; credit: number; memo?: string; contactId?: string | null }
export type Entry = {
  id: string; date: string; memo: string; sourceKind: string; sourceId?: string | null
  preparedBy: string; preparedKind: 'person' | 'agent' | 'import'; proposalId?: string | null; documentId?: string | null; revision?: string
  adjusting?: boolean
  lines: Line[]
}

/** Insert an entry as a draft; with `postedBy`, post it in the same batch (the trigger checks balance and locks). */
export function entryStatements(e: Entry, postedBy?: string): Sql[] {
  const statements: Sql[] = [
    q('INSERT INTO pt_journal_entries (id, entry_date, memo, source_kind, source_id, status, prepared_by, prepared_kind, proposal_id, document_id, revision, created_at, adjusting) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      e.id, e.date, e.memo, e.sourceKind, e.sourceId ?? null, 'draft', e.preparedBy, e.preparedKind, e.proposalId ?? null, e.documentId ?? null, e.revision ?? uid(), now(), e.adjusting ? 1 : 0),
    ...e.lines.map((l, i) => q('INSERT INTO pt_journal_lines (id, entry_id, line_no, account_id, debit_cents, credit_cents, memo, contact_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      uid(), e.id, i + 1, l.accountId, l.debit, l.credit, l.memo ?? '', l.contactId ?? null)),
  ]
  if (postedBy) statements.push(...postStatements(e.id, postedBy))
  return statements
}

export const postStatements = (id: string, postedBy: string, revision?: string): Sql[] => [
  q(`UPDATE pt_journal_entries SET status = 'posted', number = (SELECT COALESCE(MAX(number), 0) + 1 FROM pt_journal_entries), posted_by = ?, posted_at = ?, revision = ? WHERE id = ? AND status = 'draft'${revision ? ' AND revision = ?' : ''}`,
    postedBy, now(), uid(), id, ...(revision ? [revision] : [])),
  changed(),
]

export const balanced = (lines: Line[]) => {
  const debit = lines.reduce((s, l) => s + l.debit, 0), credit = lines.reduce((s, l) => s + l.credit, 0)
  return { debit, credit, ok: lines.length >= 2 && debit === credit && debit > 0 }
}

/** Parse person- or agent-supplied lines: one side per line, real active accounts. */
export async function parseLines(db: D1Database, raw: unknown, { control = false } = {}): Promise<Line[]> {
  const lines = list<Data>(raw, 'Journal lines', 200).map((l, i) => {
    const label = `Line ${i + 1}`
    const debit = l.debit === undefined || l.debit === '' ? 0 : cents(l.debit, `${label} debit`, { zero: true })
    const credit = l.credit === undefined || l.credit === '' ? 0 : cents(l.credit, `${label} credit`, { zero: true })
    requireThat((debit > 0) !== (credit > 0), `${label} needs either a debit or a credit`)
    return { accountId: text(l.accountId, `${label} account`), debit, credit, memo: optionalText(l.memo, `${label} memo`, 500), contactId: l.contactId ? text(l.contactId, `${label} contact`) : null }
  })
  const accounts = new Map((await all(db, 'SELECT id, subtype, active, name FROM pt_accounts')).map(a => [a.id, a]))
  for (const [i, l] of lines.entries()) {
    const a = accounts.get(l.accountId)
    requireThat(a && a.active, `Line ${i + 1}: account not found or inactive`)
    requireThat(control || !['receivable', 'payable'].includes(a.subtype), `Line ${i + 1}: ${a.name} is a control account; record invoices, bills and payments instead`)
    if (l.contactId) requireThat(await one(db, 'SELECT 1 FROM pt_contacts WHERE id = ?', l.contactId), `Line ${i + 1}: contact not found`)
  }
  const b = balanced(lines)
  requireThat(b.ok, `Entry does not balance: debits ${(b.debit / 100).toFixed(2)}, credits ${(b.credit / 100).toFixed(2)}`)
  return lines
}

export async function entry(db: D1Database, id: string) {
  const row = await one(db, 'SELECT * FROM pt_journal_entries WHERE id = ?', id)
  requireThat(row, 'Journal entry not found', 404)
  row.adjusting = Boolean(row.adjusting)
  row.lines = await all(db, 'SELECT l.*, a.code AS account_code, a.name AS account_name FROM pt_journal_lines l JOIN pt_accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.line_no', id)
  return row
}

const draftSnapshot = (e: Data) => ({ revision: e.revision, date: e.entry_date, memo: e.memo, documentId: e.document_id, status: e.status, adjusting: Boolean(e.adjusting),
  lines: e.lines.map((l: Data) => ({ accountId: l.account_id, debit: l.debit_cents, credit: l.credit_cents, memo: l.memo, contactId: l.contact_id })) })

async function assertAdjustingDate(db: D1Database, day: string) {
  const entity = await one(db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
  requireThat(entity, 'Set up the business before recording an adjusting entry')
  const endMonth = entity.fiscal_year_start === 1 ? 12 : entity.fiscal_year_start - 1
  const end = new Date(day + 'T00:00:00Z')
  end.setUTCMonth(endMonth, 0)
  const endDay = end.toISOString().slice(0, 10)
  requireThat(day === endDay, `Adjusting entries must be dated on the fiscal year end (${endDay})`)
}

const saveDraft: Command = { need: 'record', async run(c, b) {
  const day = date(b.date, 'Entry date'), memo = text(b.memo, 'Description', 500)
  requireThat(b.adjusting === undefined || typeof b.adjusting === 'boolean', 'Adjusting entry must be true or false')
  const adjusting = b.adjusting ?? false
  if (adjusting) await assertAdjustingDate(c.db, day)
  await assertOpen(c.db, day)
  const lines = await parseLines(c.db, b.lines)
  const scope = await ledgerBankAuthority(c.db, c.actor, lines.map(l => l.accountId))
  const documentId = b.documentId ? text(b.documentId, 'Document') : null
  if (documentId) requireThat(await one(c.db, 'SELECT 1 FROM pt_documents WHERE id = ?', documentId), 'Document not found', 404)
  if (!b.id) {
    const id = uid(), revision = uid()
    await run(c.db, [authority(c.actor, 'record'), ...scope, ...entryStatements({ id, revision, date: day, memo, sourceKind: 'manual', preparedBy: c.actor.email, preparedKind: 'person', documentId, adjusting, lines }), audit(who(c.actor), 'journal.draft', 'journal', id, { date: day, memo, before: null, after: { revision, date: day, memo, documentId, adjusting, status: 'draft', lines } })])
    return entry(c.db, id)
  }
  const current = await entry(c.db, text(b.id, 'Entry'))
  requireThat(current.status === 'draft' && current.source_kind === 'manual', 'Only manual drafts can be edited', 409)
  requireThat(current.revision === b.revision, 'Entry changed; reload', 409)
  const revision = uid()
  await run(c.db, [authority(c.actor, 'record'), ...scope,
    q('UPDATE pt_journal_entries SET entry_date = ?, memo = ?, document_id = ?, adjusting = ?, prepared_by = ?, revision = ? WHERE id = ? AND revision = ? AND status = ?', day, memo, documentId, adjusting ? 1 : 0, c.actor.email, revision, current.id, b.revision, 'draft'), changed(),
    q('DELETE FROM pt_journal_lines WHERE entry_id = ?', current.id),
    ...lines.map((l, i) => q('INSERT INTO pt_journal_lines (id, entry_id, line_no, account_id, debit_cents, credit_cents, memo, contact_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', uid(), current.id, i + 1, l.accountId, l.debit, l.credit, l.memo ?? '', l.contactId ?? null)),
    audit(who(c.actor), 'journal.edit', 'journal', current.id, { date: day, memo, before: draftSnapshot(current), after: { revision, date: day, memo, documentId, adjusting, status: 'draft', lines } })])
  return entry(c.db, current.id)
} }

const deleteDraft: Command = { need: 'record', async run(c, b) {
  const current = await entry(c.db, text(b.id, 'Entry'))
  requireThat(current.status === 'draft' && current.source_kind === 'manual', 'Only manual drafts can be discarded', 409)
  await run(c.db, [authority(c.actor, 'record'), ...await ledgerBankAuthority(c.db, c.actor, current.lines.map((l: Data) => l.account_id)), q('DELETE FROM pt_journal_lines WHERE entry_id = ?', current.id), q("DELETE FROM pt_journal_entries WHERE id = ? AND revision = ? AND status = 'draft'", current.id, b.revision), changed(), audit(who(c.actor), 'journal.discard', 'journal', current.id, { before: draftSnapshot(current), after: null })])
  return { id: current.id }
} }

/** Posting a manual draft is an approval of the exact revision the approver reviewed. */
const post: Command = { need: 'post', async run(c, b) {
  const current = await entry(c.db, text(b.id, 'Entry'))
  requireThat(current.status === 'draft', 'Entry is already posted', 409)
  requireThat(current.source_kind === 'manual', 'Opening balances post through the cutover sign-off', 409)
  requireThat(current.revision === b.revision, 'Entry changed since you reviewed it; review it again', 409)
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || current.prepared_by !== c.actor.email), 'Someone other than the preparer approves this entry', 403)
  if (current.adjusting) await assertAdjustingDate(c.db, current.entry_date)
  await assertOpen(c.db, current.entry_date)
  await run(c.db, [authority(c.actor, 'post'), ...nativeApprovalAuthority(c.actor, 'journal', current.lines.reduce((sum: number, l: Data) => sum + l.debit_cents, 0)), ...await ledgerBankAuthority(c.db, c.actor, current.lines.map((l: Data) => l.account_id), 'post'), approval(who(c.actor), 'journal', current.id, current.revision, 'post', 'approved', optionalText(b.note, 'Note', 500)), ...postStatements(current.id, c.actor.email, current.revision), audit(who(c.actor), 'journal.post', 'journal', current.id, { before: draftSnapshot(current), after: { status: 'posted', postedBy: c.actor.email } })])
  return entry(c.db, current.id)
} }

/** `unmatching`: the same batch ends the entry's match first (undoing a filing by rule). */
export async function reversalStatements(db: D1Database, actor: AuditActor, original: Data, day: string, memo: string, { unmatching = false } = {}) {
  requireThat(original.status === 'posted', 'Only posted entries are reversed; edit or discard a draft', 409)
  requireThat(!original.reversed_by_id, 'Entry is already reversed', 409)
  requireThat(day >= original.entry_date, 'A reversal is dated on or after the original entry')
  await assertOpen(db, day)
  const matched = !unmatching && await one(db, 'SELECT 1 FROM pt_match_postings mp JOIN pt_journal_lines l ON l.id = mp.journal_line_id WHERE l.entry_id = ? AND mp.active = 1', original.id)
  requireThat(!matched, 'This entry is matched to a bank statement line; undo the match first', 409)
  const id = uid()
  const paymentBanks=original.source_kind==='payment'?await all(db,'SELECT bank_account_id FROM pt_payments WHERE journal_id=?',original.id):[]
  const lines: Line[] = original.lines.map((l: Data) => ({ accountId: l.account_id, debit: l.credit_cents, credit: l.debit_cents, memo: l.memo, contactId: l.contact_id }))
  return { id, statements: [
    ...bankAuthority(actor,paymentBanks.map(p=>p.bank_account_id)),
    ...nativeApprovalAuthority(actor, original.source_kind === 'bill' ? 'bill' : original.source_kind === 'payment' ? 'payment' : 'journal', lines.reduce((sum, l) => sum + l.debit, 0), original.source_kind === 'bank' ? 'record' : undefined),
    ...await ledgerBankAuthority(db, actor, lines.map(l => l.accountId), original.source_kind === 'manual' ? 'post' : 'record'),
    ...entryStatements({ id, date: day, memo, sourceKind: 'reversal', sourceId: original.id, preparedBy: actor.email, preparedKind: 'person', lines }),
    q('UPDATE pt_journal_entries SET reverses_id = ? WHERE id = ?', original.id, id),
    ...postStatements(id, actor.email),
    q('UPDATE pt_journal_entries SET reversed_by_id = ? WHERE id = ? AND reversed_by_id IS NULL', id, original.id), changed(),
  ] }
}

const reverse: Command = { need: 'post', async run(c, b) {
  const original = await entry(c.db, text(b.id, 'Entry'))
  requireThat(!await one(c.db, `SELECT 1 FROM pt_checks WHERE status <> 'void' AND ((? = 'payment' AND payment_id = ?) OR (? = 'bill' AND expense_bill_id = ?))`, original.source_kind, original.source_id, original.source_kind, original.source_id), 'Void this payment from Checks so its number and reason are retained', 409)
  requireThat(!['invoice', 'credit'].includes(original.source_kind), original.source_kind === 'credit' && await one(c.db, 'SELECT 1 FROM pt_invoices WHERE id = ? AND early_discount = 1', original.source_id)
    ? 'An early-payment discount is reversed with its payment, or by someone with the post grant giving a reason' : 'Correct an issued invoice by issuing a credit for it', 409)
  requireThat(original.source_kind !== 'reversal', 'Reverse the original entry again by posting a new correcting entry', 409)
  const day = date(b.date ?? original.entry_date, 'Reversal date'), memo = optionalText(b.memo, 'Reason', 500) || `Reversal of entry ${original.number}`
  const r = await reversalStatements(c.db, c.actor, original, day, memo)
  const extra: Sql[] = []
  const advance = await one(c.db,'SELECT id FROM pt_customer_deposits WHERE journal_id=?',original.id)
  if(advance){
    const available = `NOT EXISTS(SELECT 1 FROM pt_customer_deposit_applications a JOIN pt_payments p ON p.id=a.payment_id WHERE a.deposit_id=? AND p.reversal_id IS NULL) AND NOT EXISTS(SELECT 1 FROM pt_invoice_deposit_plans x JOIN pt_invoices i ON i.id=x.invoice_id WHERE x.deposit_id=? AND i.status<>'issued')`
    requireThat(await one(c.db,`SELECT 1 WHERE ${available}`,advance.id,advance.id),'Reverse the deposit applications and resolve reserved invoices before reversing the receipt',409)
    extra.push(guard(available,advance.id,advance.id))
  }
  if (original.source_kind === 'bill') {
    const allocated = await one(c.db, "SELECT 1 FROM pt_allocations a LEFT JOIN pt_payments p ON p.id = a.source_id AND a.source_kind = 'payment' WHERE a.target_kind = 'bill' AND a.target_id = ? AND (a.source_kind = 'credit' OR p.reversal_id IS NULL)", original.source_id)
    requireThat(!allocated, 'This bill has payments or vendor credits allocated; resolve those allocations first', 409)
    extra.push(q("UPDATE pt_bills SET status = 'void', revision = ? WHERE id = ? AND status = 'posted'", uid(), original.source_id), changed())
  }
  if (original.source_kind === 'payment') extra.push(q('UPDATE pt_payments SET reversal_id = ? WHERE journal_id = ? AND reversal_id IS NULL', r.id, original.id), changed(),
    ...await reverseEarlyDiscounts(c.db, who(c.actor), original.source_id, day, memo))
  await run(c.db, [authority(c.actor, 'post'), approval(who(c.actor), 'journal', original.id, original.revision, 'reverse', 'approved', memo), ...r.statements, ...extra, audit(who(c.actor), 'journal.reverse', 'journal', original.id, { reversal: r.id, date: day, memo })])
  return entry(c.db, r.id)
} }

export const journalCommands: Record<string, Command> = {
  'journal.save-draft': saveDraft,
  'journal.discard': deleteDraft,
  'journal.post': post,
  'journal.reverse': reverse,
}

export async function journalView(db: D1Database) {
  const entries = await all(db, 'SELECT * FROM pt_journal_entries ORDER BY CASE status WHEN \'draft\' THEN 0 ELSE 1 END, entry_date DESC, number DESC, created_at DESC, id LIMIT 300')
  const ids = entries.map(e => e.id)
  const marks = ids.map(() => '?').join(',')
  const lines = ids.length ? await all(db, `SELECT l.*, a.code AS account_code, a.name AS account_name, a.subtype AS account_subtype,
      (SELECT r.correcting_entry_id FROM pt_reclassifications r WHERE r.original_line_id = l.id) AS reclassified_by
    FROM pt_journal_lines l JOIN pt_accounts a ON a.id = l.account_id WHERE l.entry_id IN (${marks}) ORDER BY l.line_no`, ...ids) : []
  const notes = ids.length ? await all(db, `SELECT * FROM pt_review_notes WHERE entry_id IN (${marks}) ORDER BY created_at, id`, ...ids) : []
  const docs = await entryDocuments(db)
  for (const e of entries) { e.adjusting = Boolean(e.adjusting); e.lines = lines.filter(l => l.entry_id === e.id); e.documents = docs[e.id] ?? []; e.notes = notes.filter(n => n.entry_id === e.id) }
  return entries
}
