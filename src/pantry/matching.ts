import { nativeApprovalAuthority } from './access-policy/approvals'
import { bankAuthority } from './access-policy/banks'
import { suggestionDecisions } from './line-suggestions'
// Matching statement lines to ledger postings. A match links what the bank
// recorded to what the books already hold; it posts only the new items a person
// names (a fee, a receipt the books lack, a transfer), so a payment already
// recorded is never posted a second time when its bank line arrives.
import { authority, who } from './access'
import { cents, optionalText, scale, requireThat, text, uid, usd, now, type Data } from './core'
import { all, assertOpen, audit, changed, guard, one, periodOpen, q, run, type AuditActor, type Sql } from './db'
import { account } from './accounts'
import { entry, entryStatements, reversalStatements } from './journal'
import { paymentStatements } from './payables'
import type { Command } from './context'
import { reverseEarlyDiscounts } from './early-payment'

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
export async function matchPlan(db: D1Database, actor: AuditActor, input: MatchInput, { automatic = false, recordedReceipt = false } = {}) {
  const lines = await all(db, `SELECT * FROM pt_bank_lines WHERE id IN (${input.bankLineIds.map(() => '?').join(',')})`, ...input.bankLineIds)
  requireThat(lines.length === input.bankLineIds.length, 'A statement line was not found', 404)
  requireThat(lines.every(l => !l.excluded_at),'Restore an excluded line before filing it',409)
  requireThat(lines.every(l => !l.removed_at), 'A bank line was removed; reload before matching', 409)
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
  const statements: Sql[] = [...bankAuthority(actor, [bankId]),...lines.flatMap(l=>[
    periodOpen(l.posted_date),guard('EXISTS(SELECT 1 FROM pt_bank_lines WHERE id=? AND posted_date=? AND amount_cents=? AND description=? AND removed_at IS NULL AND excluded_at IS NULL)',l.id,l.posted_date,l.amount_cents,l.description),
    guard('NOT EXISTS(SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id=r.statement_id WHERE r.bank_account_id=? AND ? BETWEEN s.start_date AND s.end_date)',l.bank_account_id,l.posted_date)
  ])], created: { entryId: string; signed: number; kind: string; paymentId?: string }[] = []
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
        statements.push(...bankAuthority(actor, [to.id]))
        other = { id: to.account_id }
      } else {
        other = await account(db, text(item.accountId, `${label} account`))
        requireThat(other.active && !['bank', 'receivable', 'payable'].includes(other.subtype), `${label}: choose an income, expense or other account`)
      }
      const contactId = item.contactId ? text(item.contactId, `${label} payee`) : null
      if (contactId) requireThat(await one(db, 'SELECT 1 FROM pt_contacts WHERE id = ? AND active = 1 AND kind = ?', contactId, direction === 'in' ? 'customer' : 'vendor'), 'Choose an active payee')
      const dimensions=Object.fromEntries(['className','locationName','projectName'].map(k=>[k,optionalText(item[k],k,120)]))
      requireThat(type!=='transfer'||(!item.taxCodeId&&!Object.values(dimensions).some(Boolean)),'Transfers do not carry sales tax or category dimensions')
      const code=item.taxCodeId?await one(db,'SELECT * FROM pt_tax_codes WHERE id=? AND active=1',text(item.taxCodeId,'Tax code')):null
      requireThat(!item.taxCodeId||code,'Choose an active sales tax code')
      const tax=code?scale(amount,code.rate_milli_percent,100000+code.rate_milli_percent):0
      const entryId = uid(), into = direction === 'in'
      statements.push(...nativeApprovalAuthority(actor, 'journal', amount, 'record'), ...entryStatements({ id: entryId, date: item.date ?? day, memo: memo || `${type === 'transfer' ? 'Transfer' : other.name} — ${lines[0].description}`, sourceKind: 'bank', documentId: item.documentId ?? null, preparedBy: actor.email, preparedKind: 'person', lines: [
        { accountId: into ? bank.account_id : other.id, debit: into?amount:amount-tax, credit: 0, memo, contactId: into ? null : contactId, ...(!into?dimensions:{}) },
        { accountId: into ? other.id : bank.account_id, debit: 0, credit: into?amount-tax:amount, memo, contactId: into ? contactId : null, ...(into?dimensions:{}) },
        ...(tax?[{accountId:code!.account_id,debit:into?0:tax,credit:into?tax:0,memo,...dimensions}]:[]),
      ] }, actor.email))
      created.push({ entryId, signed: into ? amount : -amount, kind: type })
    } else requireThat(false, `${label}: type is receipt, payment, fee, income or transfer`)
  }
  const statementTotal = lines.reduce((s, l) => s + l.amount_cents, 0)
  const ledgerTotal = postings.reduce((s, p) => s + p.debit_cents - p.credit_cents, 0) + created.reduce((s, x) => s + x.signed, 0)
  requireThat(statementTotal === ledgerTotal, `Match does not balance: statement ${usd(statementTotal)}, ledger ${usd(ledgerTotal)}, difference ${usd(statementTotal - ledgerTotal)}`)

  const id = uid()
  statements.push(
    q("INSERT INTO pt_matches (id, bank_account_id, status, proposal_id, note, approved_by, approved_at, revision, automatic, payment_id) VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)", id, bank.id, input.proposalId ?? null, input.note ?? '', actor.email, now(), uid(), automatic ? 1 : 0, automatic || recordedReceipt ? created.find(x => x.paymentId)?.paymentId ?? null : null),
    ...lines.map(l => q('INSERT INTO pt_match_bank_lines (match_id, bank_line_id, active) VALUES (?, ?, 1)', id, l.id)),
    ...postings.map(p => q('INSERT INTO pt_match_postings (match_id, journal_line_id, active) VALUES (?, ?, 1)', id, p.id)),
    // The new postings' bank-account lines join the match inside the same batch.
    ...created.map(x => q('INSERT INTO pt_match_postings (match_id, journal_line_id, active) SELECT ?, id, 1 FROM pt_journal_lines WHERE entry_id = ? AND account_id = ?', id, x.entryId, bank.account_id)),
    ...created.map(x=>q('INSERT INTO pt_match_created_entries(match_id,entry_id,payment_id)VALUES(?,?,?)',id,x.entryId,x.paymentId??null)),
    audit(who(actor), automatic ? 'match.automatic' : 'match.approve', 'match', id, { statementLines: lines.length, postings: postings.length, created: created.map(x => x.kind), amount: statementTotal, proposal: input.proposalId ?? null }),
  )
  return { id, statements, statementTotal, entryIds: created.map(x => x.entryId) }
}

const approveMatch: Command = { need: 'record', async run(c, b) {
  const input = matchInput(b)
  const plan = await matchPlan(c.db, c.actor, input)
  const lines = await all(c.db, `SELECT * FROM pt_bank_lines WHERE id IN (${input.bankLineIds.map(() => '?').join(',')})`, ...input.bankLineIds)
  const selected = input.create.filter(i => i.type === 'fee' || i.type === 'income').map(i => i.accountId)
  for (const payment of input.create.filter(i => i.type === 'payment')) for (const allocation of payment.allocations ?? []) {
    for (const line of await all(c.db, 'SELECT account_id FROM pt_bill_lines WHERE bill_id = ?', allocation.targetId)) selected.push(line.account_id)
  }
  // A first decision is recorded only for actual new category filings, not an
  // existing payment/transfer match where no category was chosen.
  const decisions = selected.length ? await suggestionDecisions(c.db, lines, selected, who(c.actor), input.create.map(i => i.contactId).filter(Boolean),input.create.filter(i=>i.type==='fee'||i.type==='income')) : []
  await run(c.db, [authority(c.actor, 'record'), ...plan.statements, ...decisions])
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
  const created=await all(c.db,'SELECT entry_id,payment_id FROM pt_match_created_entries WHERE match_id=?',match.id)
  // Older automatic receipt matches predate the explicit created-entry relation.
  if(match.payment_id&&!created.some(x=>x.payment_id===match.payment_id)){
    const p=await one(c.db,'SELECT journal_id FROM pt_payments WHERE id=?',match.payment_id)
    requireThat(p,'The matched payment is missing',409);created.push({entry_id:p.journal_id,payment_id:match.payment_id})
  }
  for(const record of created){
    const original=await entry(c.db,record.entry_id)
    const otherMatch='NOT EXISTS(SELECT 1 FROM pt_match_postings mp JOIN pt_journal_lines l ON l.id=mp.journal_line_id WHERE l.entry_id=? AND mp.active=1 AND mp.match_id<>?)'
    requireThat(await one(c.db,`SELECT 1 WHERE ${otherMatch}`,original.id,match.id),'Undo the other bank match before reversing this entry',409)
    reversal.push(guard(otherMatch,original.id,match.id))
    const r=await reversalStatements(c.db,c.actor,original,original.entry_date,`Undo of a bank match: ${original.memo}`,{unmatching:true})
    reversal.push(...r.statements)
    if(record.payment_id)reversal.push(q('UPDATE pt_payments SET reversal_id=? WHERE id=? AND reversal_id IS NULL',r.id,record.payment_id),changed(),
      ...await reverseEarlyDiscounts(c.db,who(c.actor),record.payment_id,original.entry_date,'the bank match that recorded its payment was undone'))
  }
  await run(c.db, [authority(c.actor, 'record'), ...bankAuthority(c.actor, [match.bank_account_id]),
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
