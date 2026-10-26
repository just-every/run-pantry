import { who } from '../access'
import { date, requireThat, sha256, text, uid, now } from '../core'
import { audit, guard, one, q, run } from '../db'
import { customerRecipients } from '../customer-profile'
import type { Command, Context } from '../context'
import { statementAuthority } from './access'
import { sendStatementDeliveries } from './delivery'
import { renderStatement, statementTitles } from './render'
import { statementSnapshot, type StatementMode } from './snapshot'
import { statement } from './store'

async function existing(c: Context, key: string, hash: string) {
  const row = await one(c.db, 'SELECT id,request_hash FROM pt_customer_statements WHERE created_by=? AND idempotency_key=?', c.actor.email, key)
  if (!row) return null
  requireThat(row.request_hash === hash, 'This send request was already used for different statement dates or a different customer', 409)
  return statement(c, row.id)
}

const send: Command = { need: 'record', async run(c, b) {
  await statementAuthority(c, true)
  const customerId = text(b.customerId, 'Customer', 100), mode = text(b.mode, 'Statement type', 30) as StatementMode
  requireThat(Object.hasOwn(statementTitles, mode), 'Choose open items, balance forward or transaction list')
  const from = date(b.from, 'From'), to = date(b.to, 'To'), key = text(b.idempotencyKey, 'Send request', 200)
  requireThat(from <= to, 'From must be on or before To')
  requireThat(from > '0001-01-01', 'Choose a statement start after 1 January in year 1')
  const hash = await sha256(JSON.stringify({ customerId, mode, from, to }))
  const replay = await existing(c, key, hash)
  if (replay) return replay
  const books = (await one(c.db, 'SELECT COALESCE(max(rowid),0) AS revision FROM pt_audit'))!.revision
  const customer = await one(c.db, "SELECT * FROM pt_contacts WHERE id=? AND kind='customer' AND active=1", customerId)
  requireThat(customer, 'Choose an active customer', 404)
  const recipients = customerRecipients(customer)
  requireThat(recipients.length, 'Add a customer billing email before sending a statement', 409)
  const snapshot = await statementSnapshot(c.db, customerId, mode, from, to)
  const rendered = renderStatement(snapshot, new URL(c.request.url).origin), digest = await sha256(rendered.html), id = uid(), at = now()
  const deliveries = recipients.map(recipient => ({ id: uid(), recipient }))
  try {
    await run(c.db, [await statementAuthority(c, true),
      guard('(SELECT COALESCE(max(rowid),0) FROM pt_audit)=?', books),
      q(`INSERT INTO pt_customer_statements(id,customer_id,mode,from_date,to_date,created_at,created_by,idempotency_key,request_hash,snapshot_json,subject,text_body,html_body,sha256)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, customerId, mode, from, to, at, c.actor.email, key, hash, JSON.stringify(snapshot), rendered.subject, rendered.text, rendered.html, digest),
      ...deliveries.map(d => q("INSERT INTO pt_customer_statement_deliveries(id,statement_id,recipient,status,at)VALUES(?,?,?,'sending',?)", d.id, id, d.recipient, at)),
      audit(who(c.actor), 'customer-statement.send', 'customer-statement', id, { customerId, mode, from, to, sha256: digest, recipients: recipients.length })])
  } catch (error) {
    const concurrent = await existing(c, key, hash)
    if (concurrent) return concurrent
    throw error
  }
  await sendStatementDeliveries(c, { ...snapshot, ...rendered, id }, deliveries)
  return statement(c, id)
} }

export const statementCommands: Record<string, Command> = { 'statement.send': send }
