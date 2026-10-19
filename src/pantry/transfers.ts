// Recognise money moving between the business's accounts. Evidence names the
// other account; amount alone never establishes identity. Both matches and the
// single balanced posting commit together.
import { authority, who } from './access'
import { addDays, Fault, now, requireThat, text, uid, type Data } from './core'
import { all, audit, changed, guard, one, periodOpen, q, run, type Sql } from './db'
import { entry, entryStatements, reversalStatements } from './journal'
import type { Command } from './context'

const actor = { email: 'pantry:transfers', kind: 'system' as const }
const normalize = (s: string) => ` ${String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `
const waiting = "status IN ('pending', 'exception')"
const isTransfer = (l: Data) => /\b(TRANSFER|XFER|TRNSFR)\b|\bPAYMENT (THANK YOU|RECEIVED)\b|\b(AUTO|ONLINE|CREDIT CARD|CARD) PAYMENT\b/.test(normalize(l.description))

/** US banking business days, including observed federal holidays. */
function businessDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`), y = d.getUTCFullYear(), weekday = d.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const observed = (year: number, month: number, date: number) => {
    const x = new Date(Date.UTC(year, month - 1, date, 12)), w = x.getUTCDay()
    x.setUTCDate(x.getUTCDate() + (w === 0 ? 1 : w === 6 ? -1 : 0))
    return x.toISOString().slice(0, 10)
  }
  const nth = (month: number, w: number, n: number) => {
    const x = new Date(Date.UTC(y, month - 1, 1, 12))
    return `${y}-${String(month).padStart(2, '0')}-${String(1 + (w - x.getUTCDay() + 7) % 7 + 7 * (n - 1)).padStart(2, '0')}`
  }
  const memorial = new Date(Date.UTC(y, 4, 31, 12)); memorial.setUTCDate(31 - (memorial.getUTCDay() + 6) % 7)
  return ![observed(y, 1, 1), observed(y + 1, 1, 1), observed(y, 6, 19), observed(y, 7, 4), observed(y, 11, 11), observed(y, 12, 25),
    nth(1, 1, 3), nth(2, 1, 3), memorial.toISOString().slice(0, 10), nth(9, 1, 1), nth(10, 1, 2), nth(11, 4, 4)].includes(day)
}
function dueDate(day: string) {
  let left = 5
  while (left) { day = addDays(day, 1); if (businessDay(day)) left-- }
  return day
}

function namedAccount(line: Data, banks: Data[]) {
  const description = normalize(`${line.description} ${line.payee ?? ''}`)
  const other = banks.filter(b => b.id !== line.bank_account_id && (description.includes(` ${b.number_last4} `) || description.includes(normalize(b.name))))
  // A common name or account mask is not a unique identity.
  return other.length === 1 ? other[0] : null
}
// Feeds supply a payee; CSVs often put it before the operation instead.
// A named third party's transfer is a deposit/payment, not evidence of money
// moving between our accounts. Generic bank prefixes carry no payee identity.
function externalPayee(line: Data, banks: Data[]) {
  let payee = String(line.payee ?? '').trim()
  if (!payee) {
    const prefix = normalize(line.description).split(/\b(?:TRANSFER|XFER|TRNSFR|PAYMENT)\b/, 1)[0].trim()
    const generic = /^(?:(?:ONLINE|INTERNET|MOBILE|WEB|BANK|ACH|WIRE|ELECTRONIC|AUTOMATIC|AUTO|INTERNAL|CREDIT|DEBIT|\d+)\s*)*$/
    if (prefix && !generic.test(prefix)) payee = prefix
  }
  return !!payee && !banks.some(b => [b.institution, b.name].some(name => normalize(name) === normalize(payee)))
}
const freeLine = (l: Data) => guard(`EXISTS (SELECT 1 FROM pt_bank_lines WHERE id = ? AND posted_date = ? AND amount_cents = ? AND description = ? AND removed_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id = r.statement_id WHERE r.bank_account_id = ? AND ? BETWEEN s.start_date AND s.end_date)`, l.id, l.posted_date, l.amount_cents, l.description, l.bank_account_id, l.posted_date)

/** Pending halves are work, even when no provider is configured or connected now. */
export async function transferState(db: D1Database) {
  return all(db, `SELECT h.*, b.name AS expected_account, l.posted_date, l.description, l.amount_cents, l.bank_account_id,
    CASE WHEN h.status IN ('pending', 'exception') AND EXISTS (SELECT 1 FROM pt_periods WHERE status = 'locked' AND l.posted_date BETWEEN start_date AND end_date) THEN 'Reopen the locked period before pairing' ELSE NULL END AS blocked,
    p.status AS pair_status, p.journal_id, p.created_entry
    FROM pt_transfer_halves h JOIN pt_bank_lines l ON l.id = h.bank_line_id LEFT JOIN pt_bank_accounts b ON b.id = h.expected_bank_account_id
    LEFT JOIN pt_transfer_pairs p ON p.id = h.pair_id WHERE l.removed_at IS NULL
      AND (h.status NOT IN ('pending', 'exception') OR NOT EXISTS (SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = l.id AND active = 1))`)
}

/** Automatic invoice/payment filing leaves reserved transfer halves alone. */
export async function transferAvailableLines(db: D1Database, ids: string[]) {
  const held = new Set((await all(db, `SELECT bank_line_id FROM pt_transfer_halves WHERE ${waiting}`)).map(h => h.bank_line_id))
  return ids.filter(id => !held.has(id))
}

async function pair(db: D1Database, outgoing: Data, incoming: Data, banks: Data[]) {
  const from = banks.find(b => b.id === outgoing.bank_account_id)!, to = banks.find(b => b.id === incoming.bank_account_id)!
  // Reuse a recorded two-account transfer, including one whose first side was
  // already matched by a person. Never adopt an income/expense or split entry.
  const recorded = await all(db, `SELECT e.id FROM pt_journal_entries e JOIN pt_journal_lines a ON a.entry_id = e.id JOIN pt_journal_lines b ON b.entry_id = e.id
    WHERE e.status = 'posted' AND e.reversed_by_id IS NULL AND a.account_id = ? AND a.credit_cents = ? AND a.debit_cents = 0
      AND b.account_id = ? AND b.debit_cents = ? AND b.credit_cents = 0 AND (SELECT COUNT(*) FROM pt_journal_lines WHERE entry_id = e.id) = 2
      AND e.entry_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM pt_match_postings mp JOIN pt_journal_lines jl ON jl.id = mp.journal_line_id WHERE jl.entry_id = e.id AND mp.active = 1 AND mp.match_id NOT IN (?, ?))`,
    from.account_id, -outgoing.amount_cents, to.account_id, incoming.amount_cents,
    [outgoing.posted_date, incoming.posted_date].sort()[0], [outgoing.posted_date, incoming.posted_date].sort()[1], outgoing.match_id ?? '', incoming.match_id ?? '')
  if (recorded.length > 1 || ((outgoing.match_id || incoming.match_id) && recorded.length !== 1)) return false
  const journalId = recorded[0]?.id ?? uid(), id = uid(), matches = [outgoing.match_id ?? uid(), incoming.match_id ?? uid()]
  const statements: Sql[] = [freeLine(outgoing), freeLine(incoming), periodOpen(outgoing.posted_date), periodOpen(incoming.posted_date)]
  for (const l of [outgoing, incoming]) {
    statements.push(guard(`NOT EXISTS (SELECT 1 FROM pt_transfer_halves WHERE bank_line_id = ? AND (status NOT IN ('pending', 'exception') OR (expected_bank_account_id IS NOT NULL AND expected_bank_account_id <> ?)))`, l.id, l.id === outgoing.id ? to.id : from.id))
    statements.push(guard(`NOT EXISTS (SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1 AND match_id <> ?)`, l.id, l.match_id ?? ''))
    if (l.match_id) statements.push(guard(`EXISTS (SELECT 1 FROM pt_matches m JOIN pt_match_postings mp ON mp.match_id = m.id AND mp.active = 1 JOIN pt_journal_lines jl ON jl.id = mp.journal_line_id WHERE m.id = ? AND m.status = 'approved' AND m.reconciliation_id IS NULL AND jl.entry_id = ?)
      AND (SELECT COUNT(*) FROM pt_match_bank_lines WHERE match_id = ? AND active = 1) = 1`, l.match_id, journalId, l.match_id))
  }
  if (!recorded.length) statements.push(...entryStatements({ id: journalId, date: outgoing.posted_date, memo: `Transfer — ${from.name} to ${to.name}`, sourceKind: 'bank', sourceId: id, preparedBy: actor.email, preparedKind: 'person', lines: [
    { accountId: to.account_id, debit: incoming.amount_cents, credit: 0 }, { accountId: from.account_id, debit: 0, credit: -outgoing.amount_cents },
  ] }, actor.email))
  else statements.push(guard("EXISTS (SELECT 1 FROM pt_journal_entries WHERE id = ? AND status = 'posted' AND reversed_by_id IS NULL)", journalId))
  for (const [i, l] of [outgoing, incoming].entries()) {
    if (!l.match_id) statements.push(
      q("INSERT INTO pt_matches (id, bank_account_id, status, note, approved_by, approved_at, revision, automatic) VALUES (?, ?, 'approved', ?, ?, ?, ?, 1)", matches[i], l.bank_account_id, `Paired transfer ${id}`, actor.email, now(), uid()),
      q('INSERT INTO pt_match_bank_lines (match_id, bank_line_id, active) VALUES (?, ?, 1)', matches[i], l.id),
      q('INSERT INTO pt_match_postings (match_id, journal_line_id, active) SELECT ?, id, 1 FROM pt_journal_lines WHERE entry_id = ? AND account_id = ?', matches[i], journalId, i === 0 ? from.account_id : to.account_id), changed(),
      audit(actor, 'transfer.match', 'match', matches[i], { pair: id, line: l.id, entry: journalId }))
  }
  statements.push(q("INSERT INTO pt_transfer_pairs (id, outgoing_line_id, incoming_line_id, journal_id, outgoing_match_id, incoming_match_id, created_entry, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'paired', ?)", id, outgoing.id, incoming.id, journalId, ...matches, recorded.length ? 0 : 1, now()))
  for (const [l, other] of [[outgoing, to], [incoming, from]]) statements.push(q(`INSERT INTO pt_transfer_halves (bank_line_id, expected_bank_account_id, basis, due_date, status, pair_id, detected_at, revision)
    VALUES (?, ?, 'paired account evidence', ?, 'paired', ?, ?, ?) ON CONFLICT(bank_line_id) DO UPDATE SET expected_bank_account_id = excluded.expected_bank_account_id, status = 'paired', pair_id = excluded.pair_id, revision = excluded.revision`, l.id, other.id, dueDate(l.posted_date), id, now(), uid()))
  statements.push(audit(actor, 'transfer.pair', 'journal', journalId, { pair: id, outgoing: outgoing.id, incoming: incoming.id, from: from.name, to: to.name, amount: incoming.amount_cents, reused: !!recorded.length }))
  try { await run(db, statements); return true } catch (e) { if (e instanceof Fault && e.status === 409) return false; throw e }
}

/** Run after arrivals and from the due-work scheduler; replays cannot post twice. */
export async function matchTransfers(db: D1Database) {
  const banks = await all(db, `SELECT b.* FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id WHERE a.active = 1`)
  const lines = await all(db, `SELECT l.*, mb.match_id, h.expected_bank_account_id, h.basis, h.status AS transfer_status,
    EXISTS (SELECT 1 FROM pt_periods WHERE status = 'locked' AND l.posted_date BETWEEN start_date AND end_date) AS locked,
    EXISTS (SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id = r.statement_id WHERE r.bank_account_id = l.bank_account_id AND l.posted_date BETWEEN s.start_date AND s.end_date) AS reconciled
    FROM pt_bank_lines l LEFT JOIN pt_transfer_halves h ON h.bank_line_id = l.id
    LEFT JOIN pt_match_bank_lines mb ON mb.bank_line_id = l.id AND mb.active = 1
    WHERE l.removed_at IS NULL AND l.rules_off = 0 AND (h.status IS NULL OR h.status IN ('pending', 'exception'))
      AND EXISTS (SELECT 1 FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id WHERE b.id = l.bank_account_id AND a.active = 1)`)
  const identified: Data[] = []
  const today = now().slice(0, 10)
  for (const l of lines) {
    const named = namedAccount(l, banks), explicit = l.basis === 'person' ? l.expected_bank_account_id : named?.id
    if (!isTransfer(l) && !(named && /\bPAYMENT\b/.test(normalize(l.description))) && l.basis !== 'person') continue
    if (!explicit && externalPayee(l, banks) && !/\bINTERNAL\b/.test(normalize(l.description))) continue
    const otherId = explicit ?? null
    identified.push({ ...l, expected_bank_account_id: otherId })
    if (!l.match_id) {
      const due = dueDate(l.posted_date), status = today > due ? 'exception' : 'pending'
      await run(db, [q(`INSERT INTO pt_transfer_halves (bank_line_id, expected_bank_account_id, basis, due_date, status, detected_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(bank_line_id) DO UPDATE SET expected_bank_account_id = excluded.expected_bank_account_id, due_date = excluded.due_date, status = excluded.status, revision = excluded.revision
        WHERE pt_transfer_halves.status IN ('pending', 'exception') AND (pt_transfer_halves.expected_bank_account_id IS NOT excluded.expected_bank_account_id OR pt_transfer_halves.status <> excluded.status OR pt_transfer_halves.due_date <> excluded.due_date)`,
        l.id, otherId, l.basis === 'person' ? 'person' : named ? 'account name or last four' : 'transfer description; choose the other account', due, status, now(), uid())])
    }
  }
  const compatible = (a: Data, b: Data) => a.bank_account_id !== b.bank_account_id && a.amount_cents === -b.amount_cents
    && (!a.expected_bank_account_id || a.expected_bank_account_id === b.bank_account_id)
    && (!b.expected_bank_account_id || b.expected_bank_account_id === a.bank_account_id)
    && (a.expected_bank_account_id === b.bank_account_id || b.expected_bank_account_id === a.bank_account_id)
  const consumed = new Set<string>(); let paired = 0
  for (const out of identified.filter(l => l.amount_cents < 0 && !l.locked && !l.reconciled)) {
    if (consumed.has(out.id)) continue
    const candidates = identified.filter(l => !l.locked && !l.reconciled && !consumed.has(l.id) && compatible(out, l))
    if (candidates.length !== 1) continue
    const into = candidates[0]
    if (identified.filter(l => !consumed.has(l.id) && compatible(into, l)).length !== 1) continue
    if (await pair(db, out, into, banks)) { consumed.add(out.id); consumed.add(into.id); paired++ }
  }
  // Removed lines stop waiting. A manually matched transfer may still need
  // its other side: retain that identity until the counterpart arrives.
  await run(db, [q(`UPDATE pt_transfer_halves SET status = 'dismissed', reason = 'Removed by the bank', revision = ? WHERE ${waiting}
    AND EXISTS (SELECT 1 FROM pt_bank_lines WHERE id = bank_line_id AND removed_at IS NOT NULL)`, uid())])
  return { paired }
}

const expect: Command = { need: 'record', async run(c, b) {
  const id = text(b.bankLineId, 'Bank line'), other = text(b.otherBankAccountId, 'Other bank account')
  const line = await one(c.db, 'SELECT * FROM pt_bank_lines WHERE id = ? AND removed_at IS NULL', id)
  requireThat(line, 'Bank line not found', 404)
  requireThat(line.bank_account_id !== other && await one(c.db, 'SELECT id FROM pt_bank_accounts WHERE id = ?', other), 'Choose a different bank account')
  const current = await one(c.db, 'SELECT * FROM pt_transfer_halves WHERE bank_line_id = ?', id)
  requireThat(!current || (['pending', 'exception'].includes(current.status) && current.revision === b.revision), 'Transfer changed; reload before choosing its account', 409)
  await run(c.db, [authority(c.actor, 'record'), freeLine(line), periodOpen(line.posted_date), guard('NOT EXISTS (SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1)', id),
    ...(current ? [guard('EXISTS (SELECT 1 FROM pt_transfer_halves WHERE bank_line_id = ? AND revision = ?)', id, current.revision)] : [guard('NOT EXISTS (SELECT 1 FROM pt_transfer_halves WHERE bank_line_id = ?)', id)]),
    q(`INSERT INTO pt_transfer_halves (bank_line_id, expected_bank_account_id, basis, due_date, status, detected_at, revision) VALUES (?, ?, 'person', ?, 'pending', ?, ?)
      ON CONFLICT(bank_line_id) DO UPDATE SET expected_bank_account_id = excluded.expected_bank_account_id, basis = 'person', status = 'pending', revision = excluded.revision`, id, other, dueDate(line.posted_date), now(), uid()),
    audit(who(c.actor), 'transfer.expect', 'bank-line', id, { otherBankAccountId: other })])
  await matchTransfers(c.db)
  return { id }
} }
const dismiss: Command = { need: 'record', async run(c, b) {
  const id = text(b.bankLineId, 'Bank line'), reason = text(b.reason, 'Reason', 500)
  const line = await one(c.db, 'SELECT * FROM pt_bank_lines WHERE id = ?', id)
  requireThat(line, 'Bank line not found', 404)
  await run(c.db, [authority(c.actor, 'record'), freeLine(line), periodOpen(line.posted_date),
    q(`UPDATE pt_transfer_halves SET status = 'dismissed', reason = ?, revision = ? WHERE bank_line_id = ? AND revision = ? AND ${waiting}`, reason, uid(), id, b.revision), changed(),
    audit(who(c.actor), 'transfer.dismiss', 'bank-line', id, { reason })])
  return { id }
} }
const undo: Command = { need: 'record', async run(c, b) {
  const p = await one(c.db, "SELECT * FROM pt_transfer_pairs WHERE id = ? AND status = 'paired'", text(b.id, 'Transfer'))
  requireThat(p, 'Paired transfer not found', 404)
  const reason = text(b.reason, 'Reason', 500), original = await entry(c.db, p.journal_id)
  const lines = await all(c.db, 'SELECT * FROM pt_bank_lines WHERE id IN (?, ?)', p.outgoing_line_id, p.incoming_line_id)
  const reversal = p.created_entry ? await reversalStatements(c.db, c.actor, original, original.entry_date, `Undo transfer pairing: ${reason}`, { unmatching: true }) : null
  await run(c.db, [authority(c.actor, 'record'), ...lines.flatMap(l => [periodOpen(l.posted_date), freeLine(l)]),
    guard('NOT EXISTS (SELECT 1 FROM pt_matches WHERE id IN (?, ?) AND (status <> \'approved\' OR reconciliation_id IS NOT NULL))', p.outgoing_match_id, p.incoming_match_id),
    q("UPDATE pt_transfer_pairs SET status = 'undone', undone_by = ?, undone_at = ?, reason = ? WHERE id = ? AND status = 'paired'", c.actor.email, now(), reason, p.id), changed(),
    q("UPDATE pt_matches SET status = 'undone', revision = ? WHERE id IN (?, ?)", uid(), p.outgoing_match_id, p.incoming_match_id), changed(2),
    q('UPDATE pt_match_bank_lines SET active = 0 WHERE match_id IN (?, ?)', p.outgoing_match_id, p.incoming_match_id), q('UPDATE pt_match_postings SET active = 0 WHERE match_id IN (?, ?)', p.outgoing_match_id, p.incoming_match_id),
    ...(reversal?.statements ?? []),
    q("UPDATE pt_transfer_halves SET status = 'dismissed', reason = ?, revision = ? WHERE pair_id = ?", reason, uid(), p.id),
    audit(who(c.actor), 'transfer.undo', 'journal', p.journal_id, { pair: p.id, reason, reversal: reversal?.id ?? null })])
  return { id: p.id }
} }
export const transferCommands: Record<string, Command> = { 'transfer.expect': expect, 'transfer.dismiss': dismiss, 'transfer.undo': undo }
