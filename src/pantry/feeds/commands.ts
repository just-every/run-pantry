// Connecting banks and cards: Plaid Link on the connect page, then the person
// chooses which of the institution's accounts come into which Pantry bank
// account. Re-link reopens Link for the same connection; disconnect ends it.
import { runtimeBindings } from '../../auth.server'
import { authority, who } from '../access'
import { Fault, now, requireThat, text, uid, type Data } from '../core'
import { all, audit, one, q, run } from '../db'
import { bankCommands } from '../bank'
import type { Command, Context } from '../context'
import { availability, plaid, PlaidError } from './plaid'
import { syncItem } from './sync'
import { open, seal } from './vault'

const webhookUrl = (c: Context) => {
  const origin = runtimeBindings(c.env).AUTH_ORIGIN
  return origin.startsWith('https://') ? `${origin}/api/pantry/feeds/plaid/webhook` : undefined
}

async function item(c: Context, id: unknown) {
  const row = await one(c.db, 'SELECT * FROM pt_feed_items WHERE id = ?', text(id, 'Connection'))
  requireThat(row, 'Connection not found', 404)
  return row
}

/** Plaid's refusal in one plain sentence; anything else is not Plaid's to explain. */
async function plaidCall<T>(work: () => Promise<T>): Promise<T> {
  try { return await work() } catch (e) {
    if (e instanceof PlaidError) throw new Fault(e.status >= 500 ? 502 : 409, e.display || e.message)
    throw e
  }
}

const linkToken: Command = { need: 'record', async run(c, b) {
  const client = plaid(c.env)
  let accessToken: string | undefined
  if (b.itemId) {
    const row = await item(c, b.itemId)
    accessToken = await open(c.env.SESSION_SECRET, row.access_token) ?? undefined
    requireThat(accessToken, 'This connection cannot be re-linked here; connect the bank again', 409)
  }
  const r = await plaidCall(() => client.linkToken({ userId: c.actor.id, webhook: webhookUrl(c), accessToken, redirectUri: c.env.PLAID_REDIRECT_URI || undefined }))
  return { linkToken: r.link_token, expiration: r.expiration, environment: client.environment }
} }

const connect: Command = { need: 'record', async run(c, b) {
  const client = plaid(c.env)
  const exchanged = await plaidCall(() => client.exchange(text(b.publicToken, 'Public token', 300)))
  const found = await plaidCall(() => client.accounts(exchanged.access_token))
  const institution = b.institution && typeof b.institution === 'object' ? b.institution as Data : {}
  const id = uid(), sealed = await seal(c.env.SESSION_SECRET, exchanged.access_token)
  const name = String(institution.name ?? '').trim().slice(0, 120) || 'Bank'
  // Not due until the person chooses where its accounts go.
  await run(c.db, [authority(c.actor, 'record'),
    q("INSERT INTO pt_feed_items (id, provider, item_id, institution_id, institution_name, access_token, status, sync_due_at, connected_by, connected_at, revision) VALUES (?, 'plaid', ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
      id, exchanged.item_id, String(institution.institution_id ?? found.item.institution_id ?? '').slice(0, 60), name, sealed, '9999-12-31T00:00:00Z', c.actor.email, now(), uid()),
    ...found.accounts.map(a => q('INSERT INTO pt_feed_accounts (id, item_id, provider_account_id, name, mask, kind, balance_cents, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      uid(), id, a.account_id, (a.name || a.official_name || 'Account').slice(0, 120), a.mask ?? '', [a.type, a.subtype].filter(Boolean).join(' '), typeof a.balances?.current === 'number' ? Math.round(a.balances.current * 100) : null, uid())),
    audit(who(c.actor), 'feed.connect', 'feed', id, { institution: name, accounts: found.accounts.length })])
  return connectionView(c.db, id)
} }

/** Bring accounts in: each to an existing bank account, a new one, or left out. Then the first sync runs. */
const mapAccounts: Command = { need: 'record', async run(c, b) {
  const row = await item(c, b.itemId)
  requireThat(row.status !== 'disconnected', 'This connection was disconnected; connect the bank again', 409)
  requireThat(Array.isArray(b.accounts) && b.accounts.length, 'Choose where each account goes')
  const known = new Map((await all(c.db, 'SELECT * FROM pt_feed_accounts WHERE item_id = ?', row.id)).map(a => [a.id, a]))
  const choices: { id: string; bankAccountId: string | null }[] = []
  for (const a of b.accounts as Data[]) {
    const current = known.get(String(a.id))
    requireThat(current, 'Account not found in this connection', 404)
    let bankAccountId: string | null = a.bankAccountId ? String(a.bankAccountId) : null
    const debt = current.kind.startsWith('credit') || current.kind === 'loan line of credit'
    const expectedType = debt ? 'liability' : 'asset'
    const ledger = bankAccountId === 'new'
      ? await one(c.db, 'SELECT * FROM pt_accounts WHERE id = ?', a.new?.accountId ?? '')
      : bankAccountId ? await one(c.db, 'SELECT l.* FROM pt_accounts l JOIN pt_bank_accounts b ON b.account_id = l.id WHERE b.id = ?', bankAccountId) : null
    if (bankAccountId) requireThat(ledger?.active && ledger.subtype === 'bank' && ledger.type === expectedType, debt ? 'Map a card or line of credit to an active liability bank account' : 'Map a deposit account to an active asset bank account')
    if (bankAccountId === 'new') bankAccountId = String((await bankCommands['bank-account.save'].run(c, { institution: row.institution_name, ...(a.new ?? {}), numberLast4: a.new?.numberLast4 || current.mask })).id)
    if (bankAccountId) requireThat(await one(c.db, 'SELECT 1 FROM pt_bank_accounts WHERE id = ?', bankAccountId), 'Bank account not found', 404)
    choices.push({ id: current.id, bankAccountId })
  }
  const ids = choices.map(x => x.bankAccountId).filter(Boolean)
  requireThat(new Set(ids).size === ids.length, 'Bring each account into a different Pantry bank account')
  await run(c.db, [authority(c.actor, 'record'),
    ...choices.map(x => q('UPDATE pt_feed_accounts SET bank_account_id = ?, revision = ? WHERE id = ?', x.bankAccountId, uid(), x.id)),
    // From the start again, so a newly brought-in account receives its history; lines already here are recognised by id.
    q("UPDATE pt_feed_items SET cursor = '', sync_due_at = ?, revision = ? WHERE id = ?", now(), uid(), row.id),
    audit(who(c.actor), 'feed.map', 'feed', row.id, { accounts: choices })])
  const sync = row.status === 'active' ? await syncItem(c.env, row.id, 'connect') : null
  return { sync, connection: await connectionView(c.db, row.id) }
} }

const relinked: Command = { need: 'record', async run(c, b) {
  const row = await item(c, b.itemId)
  requireThat(row.status !== 'disconnected', 'This connection was disconnected; connect the bank again', 409)
  await run(c.db, [authority(c.actor, 'record'),
    q("UPDATE pt_feed_items SET status = 'active', error_code = '', error_message = '', sync_due_at = ?, revision = ? WHERE id = ?", now(), uid(), row.id),
    audit(who(c.actor), 'feed.relink', 'feed', row.id, { institution: row.institution_name })])
  return { sync: await syncItem(c.env, row.id, 'person'), connection: await connectionView(c.db, row.id) }
} }

const syncNow: Command = { need: 'record', async run(c, b) {
  const row = await item(c, b.itemId)
  requireThat(row.status === 'active', row.status === 'relink' ? `${row.institution_name} needs you to sign in again first` : 'This connection was disconnected', 409)
  plaid(c.env)
  const sync = await syncItem(c.env, row.id, 'person')
  requireThat(sync.claimed, 'A sync for this connection is already running', 409)
  return { sync, connection: await connectionView(c.db, row.id) }
} }

const disconnect: Command = { need: 'record', async run(c, b) {
  const row = await item(c, b.itemId)
  requireThat(row.status !== 'disconnected', 'Already disconnected', 409)
  const token = await open(c.env.SESSION_SECRET, row.access_token)
  // Plaid forgets the connection; an item Plaid no longer knows is already gone.
  if (token) await plaidCall(() => plaid(c.env).remove(token).catch(e => { if (e instanceof PlaidError && e.code === 'ITEM_NOT_FOUND') return null; throw e }))
  await run(c.db, [authority(c.actor, 'record'),
    q("UPDATE pt_feed_items SET status = 'disconnected', access_token = '', revision = ? WHERE id = ?", uid(), row.id),
    q('DELETE FROM pt_feed_pending WHERE feed_account_id IN (SELECT id FROM pt_feed_accounts WHERE item_id = ?)', row.id),
    q('UPDATE pt_feed_accounts SET bank_account_id = NULL WHERE item_id = ?', row.id),
    audit(who(c.actor), 'feed.disconnect', 'feed', row.id, { institution: row.institution_name })])
  return { id: row.id }
} }

export const feedCommands: Record<string, Command> = {
  'feed.link-token': linkToken,
  'feed.connect': connect,
  'feed.map': mapAccounts,
  'feed.relinked': relinked,
  'feed.sync': syncNow,
  'feed.disconnect': disconnect,
}

async function connectionView(db: D1Database, id: string) {
  const row = (await one(db, 'SELECT id, institution_name, status, error_code, error_message, last_sync_at, sync_due_at, last_sync_error, connected_by, connected_at, revision FROM pt_feed_items WHERE id = ?', id))!
  const accounts = await all(db, `SELECT f.id, f.name, f.mask, f.kind, f.bank_account_id, f.balance_cents, f.last_synced_at, b.name AS bank_name,
      (SELECT COUNT(*) FROM pt_feed_pending p WHERE p.feed_account_id = f.id) AS pending
    FROM pt_feed_accounts f LEFT JOIN pt_bank_accounts b ON b.id = f.bank_account_id WHERE f.item_id = ? ORDER BY f.name`, id)
  const last = await one(db, 'SELECT * FROM pt_feed_syncs WHERE item_id = ? ORDER BY started_at DESC LIMIT 1', id)
  return { ...row, accounts, lastSync: last }
}

export async function feedsView(ctx: Context) {
  const items = await all<{ id: string }>(ctx.db, "SELECT id FROM pt_feed_items WHERE status <> 'disconnected' ORDER BY connected_at")
  return { availability: availability(ctx.env), connections: await Promise.all(items.map(i => connectionView(ctx.db, i.id))) }
}
