// Bank accounts and statement imports. A statement is evidence of what the bank
// recorded; importing it never posts to the ledger.
import { authority, who } from './access'
import { cents, date, now, optionalText, requireThat, sha256, text, uid, type Data } from './core'
import { all, audit, guard, one, q, run, type Sql } from './db'
import { account } from './accounts'
import { documentInsert } from './contacts'
import { parseCsvStatement, parseOfxStatement, type ParsedStatement } from './statement-files'
import { applyRulesAs } from './rules'
import type { Command } from './context'

const saveBankAccount: Command = { need: 'record', async run(c, b) {
  const ledger = await account(c.db, text(b.accountId, 'Ledger account'))
  requireThat(ledger.subtype === 'bank' && ledger.active, 'Choose an active bank account from the chart')
  const last4 = text(b.numberLast4, 'Last four digits of the account number', 4)
  requireThat(/^\d{4}$/.test(last4), 'Enter the last four digits of the account number')
  const routing = optionalText(b.routing, 'Routing number', 9)
  requireThat(!routing || /^\d{9}$/.test(routing), 'Routing number has nine digits')
  const id = uid()
  await run(c.db, [authority(c.actor, 'record'),
    q('INSERT INTO pt_bank_accounts (id, name, account_id, institution, number_last4, routing, opening_date, opening_cents, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, text(b.name, 'Name', 120), ledger.id, text(b.institution, 'Bank', 120), last4, routing, date(b.openingDate, 'Opening statement date'), cents(b.openingBalance, 'Opening statement balance', { signed: true, zero: true }), uid()),
    audit(who(c.actor), 'bank-account.create', 'bank-account', id, { name: b.name, last4 })])
  return (await one(c.db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', id))!
} }

function parse(format: string, content: string): ParsedStatement {
  if (format === 'ofx') return parseOfxStatement(content)
  requireThat(format === 'csv', 'Statement format is CSV or OFX')
  return parseCsvStatement(content)
}

const importStatement: Command = { need: 'record', async run(c, b) {
  const bank = await one(c.db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', text(b.bankAccountId, 'Bank account'))
  requireThat(bank, 'Bank account not found', 404)
  const name = text(b.fileName, 'File name', 200), content = b.content
  requireThat(typeof content === 'string' && content.trim().length > 0 && content.length <= 1_400_000, 'Choose a statement file (up to 1.4 MB)')
  const format = /\.(ofx|qfx|qbo)$/i.test(name) || /<OFX>/i.test(content) ? 'ofx' : 'csv'
  const hash = await sha256(content)
  const existing = await one(c.db, 'SELECT * FROM pt_statements WHERE bank_account_id = ? AND source_sha256 = ?', bank.id, hash)
  if (existing) return { statement: existing, duplicate: true, added: 0, duplicates: existing.line_count }
  const parsed = parse(format, content)
  // Identity: an OFX file names its account; a CSV does not, so the person confirms it.
  if (parsed.account) {
    requireThat(parsed.account.accountId.replace(/\D/g, '').slice(-4) === bank.number_last4, `This statement is for account ending ${parsed.account.accountId.replace(/\D/g, '').slice(-4)}, not ${bank.name} (ending ${bank.number_last4})`, 409)
    requireThat(!bank.routing || !parsed.account.bankId || parsed.account.bankId === bank.routing, `This statement is from routing number ${parsed.account.bankId}, not ${bank.institution}`, 409)
  } else requireThat(String(b.confirmLast4 ?? '') === bank.number_last4, `Confirm the last four digits of ${bank.name} to import a CSV statement`, 409)
  const dates = parsed.lines.map(l => l.date).sort()
  const start = b.start ? date(b.start, 'Statement start') : parsed.start ?? dates[0]
  const end = b.end ? date(b.end, 'Statement end') : parsed.end ?? dates[dates.length - 1]
  requireThat(start <= end && dates[0] >= start && dates[dates.length - 1] <= end, `Statement lines run ${dates[0]} to ${dates[dates.length - 1]}, outside the statement period ${start} to ${end}`)
  // Duplicates are recognised within a format (OFX FITID, or identical CSV rows); a
  // statement in the other format covering the same days could double them, so it is refused.
  const overlap = await one(c.db, 'SELECT source_name, format FROM pt_statements WHERE bank_account_id = ? AND format <> ? AND start_date <= ? AND end_date >= ?', bank.id, format, end, start)
  requireThat(!overlap, `${overlap?.source_name} already covers these dates as ${String(overlap?.format).toUpperCase()}; import this account's statements in one format`, 409)
  const closing = b.closing !== undefined && b.closing !== '' ? cents(b.closing, 'Closing balance', { signed: true, zero: true }) : parsed.closing
  requireThat(closing !== undefined, 'Enter the closing balance printed on the statement')
  const total = parsed.lines.reduce((s, l) => s + l.amount, 0)
  // OFX carries a closing ledger balance but no opening one; without a stated opening it is derived from the file.
  const opening = b.opening !== undefined && b.opening !== '' ? cents(b.opening, 'Opening balance', { signed: true, zero: true }) : parsed.format === 'ofx' ? closing - total : undefined
  requireThat(opening !== undefined, 'Enter the opening balance printed on the statement')
  const seen = new Map<string, number>(), keyed = await Promise.all(parsed.lines.map(async l => {
    const base = l.fitid ? `fitid:${l.fitid}` : `csv:${await sha256([l.date, l.amount, l.description, l.reference].join('|'))}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { ...l, fingerprint: l.fitid ? base : `${base}#${n}` }
  }))
  const known = new Set((await all<{ fingerprint: string }>(c.db, 'SELECT fingerprint FROM pt_bank_lines WHERE bank_account_id = ?', bank.id)).map(r => r.fingerprint))
  // A line the feed already brought in (same day, same amount) is this file's line: it joins the statement instead of repeating.
  const feed = await all(c.db, "SELECT id, posted_date, amount_cents FROM pt_bank_lines WHERE bank_account_id = ? AND source = 'feed' AND statement_id IS NULL AND removed_at IS NULL AND posted_date BETWEEN ? AND ? ORDER BY id", bank.id, start, end)
  const fresh: (typeof keyed[number] & { id: string; feedLineId?: string })[] = []
  for (const l of keyed.filter(l => !known.has(l.fingerprint))) {
    const k = feed.findIndex(f => f.posted_date === l.date && f.amount_cents === l.amount)
    fresh.push({ ...l, id: k >= 0 ? feed[k].id : uid(), feedLineId: k >= 0 ? feed[k].id : undefined })
    if (k >= 0) feed.splice(k, 1)
  }
  const added = fresh.filter(l => !l.feedLineId), fromFeed = fresh.length - added.length
  const id = uid(), doc = await documentInsert(c, { name, mediaType: format === 'ofx' ? 'application/x-ofx' : 'text/csv', bytes: new TextEncoder().encode(content), linkedKind: 'statement', linkedId: id })
  const statements: Sql[] = [authority(c.actor, 'record'), doc.statement,
    q('INSERT INTO pt_statements (id, bank_account_id, format, source_name, source_sha256, start_date, end_date, opening_cents, closing_cents, line_count, duplicate_count, document_id, imported_by, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, bank.id, format, name, hash, start, end, opening, closing, added.length, keyed.length - added.length, doc.id, c.actor.email, now()),
    ...added.map(l => q("INSERT INTO pt_bank_lines (id, statement_id, bank_account_id, posted_date, amount_cents, description, reference, fingerprint, source, arrived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'file', ?)", l.id, id, bank.id, l.date, l.amount, l.description, l.reference, l.fingerprint, now())),
    ...fresh.filter(l => l.feedLineId).map(l => q('UPDATE pt_bank_lines SET statement_id = ?, fingerprint = ? WHERE id = ? AND statement_id IS NULL', id, l.fingerprint, l.feedLineId)),
    audit(who(c.actor), 'statement.import', 'statement', id, { file: name, sha256: hash, added: added.length, duplicates: keyed.length - fresh.length, fromFeed })]
  await run(c.db, statements)
  const filed = await applyRulesAs(c, added.map(l => l.id))
  return { statement: await one(c.db, 'SELECT * FROM pt_statements WHERE id = ?', id), duplicate: false, added: added.length, duplicates: keyed.length - fresh.length, fromFeed, filedByRule: filed.filed, fileBalances: { opening, closing, lineTotal: total, agrees: closing - opening === total } }
} }

/** Correct balances typed from a CSV statement before it is reconciled; the lines stay as imported. */
const correctBalances: Command = { need: 'record', async run(c, b) {
  const st = await one(c.db, 'SELECT s.*, r.id AS reconciled FROM pt_statements s LEFT JOIN pt_reconciliations r ON r.statement_id = s.id WHERE s.id = ?', text(b.id, 'Statement'))
  requireThat(st, 'Statement not found', 404)
  requireThat(!st.reconciled, 'A reconciled statement keeps its balances', 409)
  const opening = cents(b.opening, 'Opening balance', { signed: true, zero: true }), closing = cents(b.closing, 'Closing balance', { signed: true, zero: true })
  const reason = text(b.reason, 'Reason', 300)
  await run(c.db, [authority(c.actor, 'record'), guard('NOT EXISTS (SELECT 1 FROM pt_reconciliations WHERE statement_id = ?)', st.id),
    q('UPDATE pt_statements SET opening_cents = ?, closing_cents = ? WHERE id = ?', opening, closing, st.id),
    audit(who(c.actor), 'statement.correct-balances', 'statement', st.id, { from: { opening: st.opening_cents, closing: st.closing_cents }, to: { opening, closing }, reason })])
  return (await one(c.db, 'SELECT * FROM pt_statements WHERE id = ?', st.id))!
} }

export const bankCommands: Record<string, Command> = {
  'bank-account.save': saveBankAccount,
  'statement.import': importStatement,
  'statement.correct-balances': correctBalances,
}

export async function bankView(db: D1Database): Promise<Data> {
  const accounts = await all(db, 'SELECT b.*, a.code AS ledger_code, a.name AS ledger_name FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id ORDER BY b.name')
  const statements = await all(db, 'SELECT s.*, r.id AS reconciliation_id, r.completed_by, r.completed_at FROM pt_statements s LEFT JOIN pt_reconciliations r ON r.statement_id = s.id ORDER BY s.end_date DESC, s.bank_account_id, s.id')
  return { accounts, statements }
}
