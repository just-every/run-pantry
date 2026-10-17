// Matching statement lines to ledger postings. A match links what the bank
// recorded to what the books already hold; it posts only the new items a person
// names (a fee, a receipt the books lack, a transfer), so a payment already
// recorded is never posted a second time when its bank line arrives.
import { authority, who } from './access'
import { cents, optionalText, requireThat, text, uid, usd, now, type Data } from './core'
import { all, assertOpen, audit, changed, one, q, run, type AuditActor, type Sql } from './db'
import { account } from './accounts'
import { entry, entryStatements, reversalStatements } from './journal'
import { paymentStatements } from './payables'
import type { Command } from './context'

export type MatchInput = { bankLineIds: string[]; journalLineIds: string[]; create: Data[]; note?: string; proposalId?: string | null }

export function matchInput(b: Data): MatchInput {
  const ids = (v: unknown, label: string) => {
    requireThat(v === undefined || (Array.isArray(v) && v.length <= 100 && v.every(x => typeof x === 'string')), `${label} must be a list of ids`)
    return [...new Set((v ?? []) as string[])]
  }
  const input = { bankLineIds: ids(b.bankLineIds, 'Statement lines'), journalLineIds: ids(b.journalLineIds, 'Ledger postings'), create: Array.isArray(b.create) ? b.create.slice(0, 20) : [], note: optionalText(b.note, 'Note', 500) }
  requireThat(input.bankLineIds.length, 'Choose at least one statement line')
  requireThat(input.journalLineIds.length || input.create.length, 'Choose ledger postings or add the missing items')
  return input
}

/** Validate a match and build its batch. Pantry's own matches are `automatic` and name the receipt they record. */
export async function matchPlan(db: D1Database, actor: AuditActor, input: MatchInput, { automatic = false } = {}) {
  const lines = await all(db, `SELECT * FROM pt_bank_lines WHERE id IN (${input.bankLineIds.map(() => '?').join(',')})`, ...input.bankLineIds)
  requireThat(lines.length === input.bankLineIds.length, 'A statement line was not found', 404)
  const bankId = lines[0].bank_account_id
  requireThat(lines.every(l => l.bank_account_id === bankId), 'Match lines from one bank account at a time')
  const bank = (await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', bankId))!
  for (const l of lines) await assertOpen(db, l.posted_date)
  const taken = await all(db, `SELECT bank_line_id FROM pt_match_bank_lines WHERE active = 1 AND bank_line_id IN (${lines.map(() => '?').join(',')})`, ...lines.map(l => l.id))
  requireThat(!taken.length, 'A statement line is already matched', 409)
  const postings = input.journalLineIds.length ? await all(db, `SELECT l.*, e.status, e.reversed_by_id, e.entry_date FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id WHERE l.id IN (${input.journalLineIds.map(() => '?').join(',')})`, ...input.journalLineIds) : []
  requireThat(postings.length === input.journalLineIds.length, 'A ledger posting was not found', 404)
  for (const p of postings) {
    requireThat(p.status === 'posted' && !p.reversed_by_id, 'Match only posted, unreversed entries')
    requireThat(p.account_id === bank.account_id, `A chosen posting is not on ${bank.name}'s ledger account`)
  }
  const usedPostings = postings.length ? await all(db, `SELECT journal_line_id FROM pt_match_postings WHERE active = 1 AND journal_line_id IN (${postings.map(() => '?').join(',')})`, ...postings.map(p => p.id)) : []
  requireThat(!usedPostings.length, 'A ledger posting is already matched', 409)

  const day = lines.map(l => l.posted_date).sort().at(-1)!
  const statements: Sql[] = [], created: { entryId: string; signed: number; kind: string; paymentId?: string }[] = []
  for (const [i, item] of input.create.entries()) {
    const label = `New item ${i + 1}`, type = text(item.type, `${label} type`)
    const amount = cents(item.amount, `${label} amount`), memo = optionalText(item.memo, `${label} memo`, 300)
    if (type === 'receipt' || type === 'payment') {
      const p = await paymentStatements(db, actor, { direction: type === 'receipt' ? 'received' : 'paid', contactId: item.contactId, date: item.date ?? day, amount: item.amount, bankAccountId: bank.id, reference: item.reference ?? lines[0].reference, memo, allocations: item.allocations })
      statements.push(...p.statements)
      created.push({ entryId: p.journalId, signed: p.signed, kind: type, paymentId: p.id })
    } else if (type === 'fee' || type === 'income' || type === 'transfer') {
      const direction = text(item.direction ?? (type === 'income' ? 'in' : 'out'), `${label} direction`)
      requireThat(direction === 'in' || direction === 'out', `${label}: money comes in or goes out`)
      let other: Data
      if (type === 'transfer') {
        const to = await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', text(item.otherBankAccountId, `${label} other bank account`))
        requireThat(to && to.id !== bank.id, `${label}: choose the other bank account`)
        other = { id: to.account_id }
      } else {
        other = await account(db, text(item.accountId, `${label} account`))
        requireThat(other.active && !['bank', 'receivable', 'payable'].includes(other.subtype), `${label}: choose an income, expense or other account`)
      }
      const entryId = uid(), into = direction === 'in'
      statements.push(...entryStatements({ id: entryId, date: item.date ?? day, memo: memo || `${type === 'transfer' ? 'Transfer' : other.name} — ${lines[0].description}`, sourceKind: 'bank', preparedBy: actor.email, preparedKind: 'person', lines: [
        { accountId: into ? bank.account_id : other.id, debit: amount, credit: 0, memo },
        { accountId: into ? other.id : bank.account_id, debit: 0, credit: amount, memo },
      ] }, actor.email))
      created.push({ entryId, signed: into ? amount : -amount, kind: type })
    } else requireThat(false, `${label}: type is receipt, payment, fee, income or transfer`)
  }
  const statementTotal = lines.reduce((s, l) => s + l.amount_cents, 0)
  const ledgerTotal = postings.reduce((s, p) => s + p.debit_cents - p.credit_cents, 0) + created.reduce((s, x) => s + x.signed, 0)
  requireThat(statementTotal === ledgerTotal, `Match does not balance: statement ${usd(statementTotal)}, ledger ${usd(ledgerTotal)}, difference ${usd(statementTotal - ledgerTotal)}`)

  const id = uid()
  statements.push(
    q("INSERT INTO pt_matches (id, bank_account_id, status, proposal_id, note, approved_by, approved_at, revision, automatic, payment_id) VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)", id, bank.id, input.proposalId ?? null, input.note ?? '', actor.email, now(), uid(), automatic ? 1 : 0, automatic ? created.find(x => x.paymentId)?.paymentId ?? null : null),
    ...lines.map(l => q('INSERT INTO pt_match_bank_lines (match_id, bank_line_id, active) VALUES (?, ?, 1)', id, l.id)),
    ...postings.map(p => q('INSERT INTO pt_match_postings (match_id, journal_line_id, active) VALUES (?, ?, 1)', id, p.id)),
    // The new postings' bank-account lines join the match inside the same batch.
    ...created.map(x => q('INSERT INTO pt_match_postings (match_id, journal_line_id, active) SELECT ?, id, 1 FROM pt_journal_lines WHERE entry_id = ? AND account_id = ?', id, x.entryId, bank.account_id)),
    audit(who(actor), automatic ? 'match.automatic' : 'match.approve', 'match', id, { statementLines: lines.length, postings: postings.length, created: created.map(x => x.kind), amount: statementTotal, proposal: input.proposalId ?? null }),
  )
  return { id, statements, statementTotal, entryIds: created.map(x => x.entryId) }
}

const approveMatch: Command = { need: 'record', async run(c, b) {
  const plan = await matchPlan(c.db, c.actor, matchInput(b))
  await run(c.db, [authority(c.actor, 'record'), ...plan.statements])
  return { id: plan.id }
} }

/** Undo a match. Undoing one Pantry made by itself also reverses the receipt it recorded, so the invoice is open again. */
const undoMatch: Command = { need: 'record', async run(c, b) {
  const match = await one(c.db, 'SELECT * FROM pt_matches WHERE id = ?', text(b.id, 'Match'))
  requireThat(match && match.status === 'approved', 'Match not found', 404)
  requireThat(!match.reconciliation_id, 'This match is part of a completed reconciliation', 409)
  const days = await all(c.db, 'SELECT l.posted_date FROM pt_match_bank_lines m JOIN pt_bank_lines l ON l.id = m.bank_line_id WHERE m.match_id = ?', match.id)
  for (const d of days) await assertOpen(c.db, d.posted_date)
  const reversal: Sql[] = []
  if (match.automatic && match.payment_id) {
    const payment = (await one(c.db, 'SELECT * FROM pt_payments WHERE id = ?', match.payment_id))!
    const original = await entry(c.db, payment.journal_id)
    const r = await reversalStatements(c.db, who(c.actor), original, original.entry_date, `Undo of an automatic match: ${original.memo}`, { unmatching: true })
    reversal.push(...r.statements, q('UPDATE pt_payments SET reversal_id = ? WHERE id = ? AND reversal_id IS NULL', r.id, payment.id), changed())
  }
  await run(c.db, [authority(c.actor, 'record'),
    q("UPDATE pt_matches SET status = 'undone', revision = ? WHERE id = ? AND status = 'approved' AND reconciliation_id IS NULL", uid(), match.id), changed(),
    q('UPDATE pt_match_bank_lines SET active = 0 WHERE match_id = ?', match.id), q('UPDATE pt_match_postings SET active = 0 WHERE match_id = ?', match.id),
    ...reversal,
    audit(who(c.actor), 'match.undo', 'match', match.id, { reason: optionalText(b.reason, 'Reason', 300), automatic: !!match.automatic })])
  return { id: match.id }
} }

export const matchCommands: Record<string, Command> = {
  'match.approve': approveMatch,
  'match.undo': undoMatch,
}
