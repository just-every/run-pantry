// A statement over existing feed lines. No synthetic transactions or feed
// balance substitutions: the person supplies the dates and printed balances.
import { authority, who } from '../access'
import { cents, date, now, requireThat, text, uid } from '../core'
import { all, audit, assertOpen, guard, one, q, run } from '../db'
import { documentStatements } from '../documents'
import type { Command, Context } from '../context'
import { plaid, PlaidError } from './plaid'
import { open } from './vault'

async function connected(c: Context, id: unknown) {
  const account = await one(c.db, `SELECT f.*, i.access_token, i.status FROM pt_feed_accounts f JOIN pt_feed_items i ON i.id = f.item_id WHERE f.id = ?`, text(id, 'Feed account'))
  requireThat(account?.bank_account_id && account.status !== 'disconnected', 'Choose a connected, mapped feed account', 409)
  const token = await open(c.env.SESSION_SECRET, account.access_token)
  requireThat(token, 'Connect the bank again on this installation', 409)
  return { account, token }
}
async function provider<T>(fn: () => Promise<T>) {
  try { return await fn() } catch (e) {
    if (e instanceof PlaidError) requireThat(false, e.display || e.message, e.status >= 500 ? 502 : 409)
    throw e
  }
}

const enable: Command = { need: 'record', async run(c, b) {
  const { token } = await connected(c, b.feedAccountId)
  const start = date(b.start, 'Statement start'), end = date(b.end, 'Statement end')
  requireThat(start <= end, 'Statement start must precede its end')
  const link = await provider(() => plaid(c.env).linkToken({ userId: c.actor.id, accessToken: token, redirectUri: c.env.PLAID_REDIRECT_URI || undefined, statements: { start_date: start, end_date: end } }))
  return { linkToken: link.link_token }
} }

const list: Command = { need: 'record', async run(c, b) {
  const { account, token } = await connected(c, b.feedAccountId)
  const result = await provider(() => plaid(c.env).statements(token))
  return { statements: result.accounts.find(a => a.account_id === account.provider_account_id)?.statements ?? [] }
} }

const create: Command = { need: 'record', async run(c, b) {
  const { account, token } = await connected(c, b.feedAccountId)
  const bank = (await one(c.db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', account.bank_account_id))!
  const start = date(b.start, 'Statement start'), end = date(b.end, 'Statement end')
  requireThat(start <= end && start > bank.opening_date, 'Statement dates must follow the opening statement date')
  await assertOpen(c.db, start); await assertOpen(c.db, end)
  const opening = cents(b.opening, 'Printed opening balance', { signed: true, zero: true }), closing = cents(b.closing, 'Printed closing balance', { signed: true, zero: true })
  const id = uid(), providerId = b.providerStatementId ? text(b.providerStatementId, 'Plaid statement', 200) : null
  const lines = await all(c.db, 'SELECT * FROM pt_bank_lines WHERE bank_account_id = ? AND posted_date BETWEEN ? AND ? AND removed_at IS NULL ORDER BY posted_date, id', bank.id, start, end)
  requireThat(!lines.some(l => l.statement_id), 'Some lines already belong to a statement; open that statement instead', 409)
  let bytes: Uint8Array, mediaType: string, name: string
  if (providerId) {
    const client = plaid(c.env), available = await provider(() => client.statements(token))
    const statement = available.accounts.find(a => a.account_id === account.provider_account_id)?.statements.find(s => s.statement_id === providerId)
    requireThat(statement, 'This statement does not belong to the selected feed account', 409)
    bytes = await provider(() => client.statementPdf(token, providerId))
    mediaType = 'application/pdf'; name = `Plaid statement ${statement.year}-${String(statement.month).padStart(2, '0')}.pdf`
  } else {
    // A local record of the typed balances, clearly labelled as such.
    bytes = new TextEncoder().encode(`Typed statement balances\nAccount,Start,End,Opening cents,Closing cents\n${bank.id},${start},${end},${opening},${closing}\n`)
    mediaType = 'text/csv'; name = `Typed statement ${start} to ${end}`
  }
  const doc = await documentStatements(c.actor.email, { name, bytes, mediaType, linkedKind: 'statement', linkedId: id })
  const unchanged = guard(`NOT EXISTS (SELECT 1 FROM pt_statements WHERE bank_account_id = ? AND start_date <= ? AND end_date >= ?)`, bank.id, end, start)
  await run(c.db, [authority(c.actor, 'record'), unchanged,
    guard("NOT EXISTS (SELECT 1 FROM pt_periods WHERE status = 'locked' AND start_date <= ? AND end_date >= ?)", end, start),
    guard('EXISTS (SELECT 1 FROM pt_feed_accounts f JOIN pt_feed_items i ON i.id = f.item_id WHERE f.id = ? AND f.bank_account_id = ? AND i.status <> ?)', account.id, bank.id, 'disconnected'),
    ...doc.statements,
    // format remains the original schema's CSV/OFX parser family; source_kind
    // describes the actual evidence, including PDF, to all readers.
    q(`INSERT INTO pt_statements (id, bank_account_id, format, source_name, source_sha256, start_date, end_date, opening_cents, closing_cents, line_count, duplicate_count, document_id, imported_by, imported_at, source_kind, provider_statement_id) VALUES (?, ?, 'csv', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`, id, bank.id, name, doc.sha256, start, end, opening, closing, lines.length, doc.id, c.actor.email, now(), providerId ? 'plaid' : 'typed', providerId),
    q('UPDATE pt_bank_lines SET statement_id = ? WHERE bank_account_id = ? AND posted_date BETWEEN ? AND ? AND statement_id IS NULL AND removed_at IS NULL', id, bank.id, start, end),
    audit(who(c.actor), 'statement.from-feed', 'statement', id, { source: providerId ? 'plaid' : 'typed', providerStatementId: providerId, documentId: doc.id, sha256: doc.sha256, opening, closing })])
  return { statement: await one(c.db, 'SELECT * FROM pt_statements WHERE id = ?', id) }
} }

export const statementCommands: Record<string, Command> = { 'feed.statement-link': enable, 'feed.statements': list, 'statement.from-feed': create }
