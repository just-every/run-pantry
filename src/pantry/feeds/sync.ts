import { matchWaitingReceipts } from '../receipts/review'
// Feed sync. Each connection (Plaid Item) is synced by one claim at a time:
// /transactions/sync pages from the stored cursor, applied idempotently on
// Plaid's transaction ids. Posted transactions become bank lines (or adopt the
// uniquely identified statement line an imported file already brought); pending ones
// are shown apart until the bank posts them; filed lines keep their original
// values and raise an exception when the bank changes them. New lines then go
// through the business's rules. Work becomes due by webhook, by schedule, or
// when a person asks; the Cron trigger and ordinary
// requests both run what is due.
import type { Bindings } from '../../auth.server'
import { now, uid, type Data } from '../core'
import { all, guard, one, q, run, type Sql } from '../db'
import { applyRules, authorFiler } from '../rules'
import { matchDeposits, matchRecorded } from '../automatch'
import { matchConnected } from '../connected-match'
import { matchTransfers, transferAvailableLines } from '../transfers'
import { availability, plaid, PlaidError, relinkMessage, type PlaidTransaction, type SyncPage } from './plaid'
import { open } from './vault'
import { historyIndex, historyObservation, removeHistoryObservation } from './history'
import { posted } from './line-write'
import { checkFeedHealth } from './health'
import { protectedLine, transactionDetails, transactionException } from './transaction-exceptions'

export type Trigger = 'connect' | 'webhook' | 'schedule' | 'person'
const LEASE_MS = 5 * 60_000, EVERY_MS = 6 * 3600_000, RETRY_MS = 3600_000
const later = (ms: number) => new Date(Date.now() + ms).toISOString()

async function claim(db: D1Database, itemId: string) {
  const id = uid(), at = now()
  const r = await db.prepare("UPDATE pt_feed_items SET claim_id = ?, claim_until = ? WHERE id = ? AND status = 'active' AND (claim_until IS NULL OR claim_until < ?)").bind(id, later(LEASE_MS), itemId, at).run()
  return r.meta.changes === 1 ? id : null
}

/** Plaid counts money leaving the account as positive; Pantry's lines are signed the bank's way round. */
const cents = (t: PlaidTransaction) => -Math.round(t.amount * 100)
const describe = (t: PlaidTransaction) => (t.name || t.merchant_name || '(no description)').slice(0, 300)


const pending = (t: PlaidTransaction, feedAccountId: string, stamp: string): Sql =>
  q(`INSERT INTO pt_feed_pending (feed_txn_id, feed_account_id, txn_date, amount_cents, description, payee, seen_at) SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM pt_bank_lines WHERE feed_txn_id = ?)
    ON CONFLICT (feed_txn_id) DO UPDATE SET txn_date = excluded.txn_date, amount_cents = excluded.amount_cents, description = excluded.description, payee = excluded.payee, seen_at = excluded.seen_at`,
    t.transaction_id, feedAccountId, t.date, cents(t), describe(t), (t.merchant_name ?? '').slice(0, 120), stamp, t.transaction_id)

const removed = (id: string, stamp: string): Sql[] => [
  transactionException(null, id, 'removed', '{"removed":true}', stamp),
  q('DELETE FROM pt_feed_pending WHERE feed_txn_id = ?', id),
  removeHistoryObservation(id, stamp),
  // Retain the provider id and statement/match history; an unfiled removed line leaves the queue.
  q(`UPDATE pt_bank_lines SET removed_at = ? WHERE feed_txn_id = ? AND NOT ${protectedLine('pt_bank_lines')}`, stamp, id),
  q('UPDATE pt_bank_lines SET feed_snapshot = ? WHERE feed_txn_id = ?', '{"removed":true}', id),
]

/** Sync one connection. Returns what changed, or `claimed: false` when another sync holds it. */
export async function syncItem(env: Bindings, itemId: string, trigger: Trigger): Promise<Data> {
  const db = env.DB, claimId = await claim(db, itemId)
  if (!claimId) return { claimed: false }
  const item = (await one(db, 'SELECT * FROM pt_feed_items WHERE id = ?', itemId))!
  const syncId = uid(), stamp = now()
  const mine = guard('EXISTS (SELECT 1 FROM pt_feed_items WHERE id = ? AND claim_id = ?)', itemId, claimId)
  const release = (sets: string, ...params: unknown[]) => run(db, [q(`UPDATE pt_feed_items SET ${sets}, claim_id = NULL, claim_until = NULL, revision = ? WHERE id = ? AND claim_id = ?`, ...params, uid(), itemId, claimId)])
  await run(db, [q('INSERT INTO pt_feed_syncs (id, item_id, trigger, started_at) VALUES (?, ?, ?, ?)', syncId, itemId, trigger, stamp)])
  try {
    const token = await open(env.SESSION_SECRET, item.access_token)
    if (!token) {
      await release("status = 'disconnected', error_code = 'KEY_ELSEWHERE', error_message = ?", 'This connection was made by another installation; connect the bank again here.')
      await run(db, [q("UPDATE pt_feed_syncs SET finished_at = ?, error_code = 'KEY_ELSEWHERE' WHERE id = ?", now(), syncId)])
      return { claimed: true, error: 'KEY_ELSEWHERE' }
    }
    const client = plaid(env)
    let cursor = item.cursor as string, pages: SyncPage[] = [], restarts = 0
    for (;;) {
      try {
        const page = await client.sync(token, cursor)
        pages.push(page); cursor = page.next_cursor
        if (!page.has_more) break
      } catch (e) {
        // Plaid asks for the whole pagination again from the cursor it started at.
        if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && restarts++ < 3) { pages = []; cursor = item.cursor; continue }
        throw e
      }
    }
    const accounts = new Map((await all(db, 'SELECT f.*, b.opening_date, (SELECT books_start FROM pt_entity WHERE id = 1) AS books_start FROM pt_feed_accounts f LEFT JOIN pt_bank_accounts b ON b.id = f.bank_account_id WHERE f.item_id = ?', itemId)).map(a => [a.provider_account_id, a]))
    const index = await historyIndex(db, itemId)
    const statements: Sql[][] = [], counts = { updated: 0, removed: 0 }
    for (const page of pages) {
      for (const t of [...page.added, ...page.modified]) {
        const a = accounts.get(t.account_id)
        if (!a?.bank_account_id || cents(t) === 0) continue
        if (!a.available_from || t.date < a.available_from) a.available_from = t.date
        if (t.date < (a.history_start ?? a.books_start) && !index.providerIds.has(t.transaction_id) && !index.history.has(t.transaction_id)) continue
        const observation = historyObservation(index, a, t, stamp)
        const changes = observation.held ? observation.statements : [...observation.statements,
          transactionException(a.id, t.transaction_id, 'modified', JSON.stringify(transactionDetails(t)), stamp, page.modified.includes(t)),
          ...(t.pending ? [pending(t, a.id, stamp), q('UPDATE pt_bank_lines SET feed_snapshot = ? WHERE feed_txn_id = ?', JSON.stringify(transactionDetails(t)), t.transaction_id)] : posted(t, a.bank_account_id, a.id, stamp)),
        ]
        if (changes.length) statements.push(changes)
      }
      counts.updated += page.modified.length
      for (const r of page.removed) { statements.push(removed(r.transaction_id, stamp)); counts.removed++ }
      for (const pa of page.accounts ?? []) {
        const a = accounts.get(pa.account_id), balance = pa.balances?.current
        if (a && typeof balance === 'number') statements.push([q('UPDATE pt_feed_accounts SET balance_cents = ? WHERE id = ?', Math.round(balance * 100), a.id)])
      }
    }
    // Keep each observation, exception and line change in one atomic batch.
    for (let i = 0; i < statements.length; i += 20) await run(db, [mine, ...statements.slice(i, i + 20).flat()])
    const mapped = [...accounts.values()].filter(a => a.bank_account_id)
    await run(db, [mine,
      ...mapped.map(a => q('UPDATE pt_feed_accounts SET last_synced_at = ?, available_from = ? WHERE id = ?', now(), a.available_from ?? null, a.id)),
      q("UPDATE pt_feed_items SET cursor = ?, last_sync_at = ?, last_sync_error = '', error_code = CASE WHEN error_code IN ('PENDING_EXPIRATION', 'PENDING_DISCONNECT') THEN error_code ELSE '' END, error_message = CASE WHEN error_code IN ('PENDING_EXPIRATION', 'PENDING_DISCONNECT') THEN error_message ELSE '' END, sync_due_at = ?, claim_id = NULL, claim_until = NULL, revision = ? WHERE id = ? AND claim_id = ?", cursor, now(), later(EVERY_MS), uid(), itemId, claimId)])
    const arrived = await all<{ id: string }>(db, 'SELECT id FROM pt_bank_lines WHERE arrived_at = ? AND source = \'feed\'', stamp)
    // Booked Stripe payouts and Gusto payrolls meet their bank lines; deposits that name exactly one open
    // invoice of their amount match themselves; rules then file what is left.
    await matchConnected(db)
    await matchTransfers(db)
    const available = await transferAvailableLines(db, arrived.map(l => l.id))
    await matchDeposits(db, available)
    await matchRecorded(db, available)
    const filed = await applyRules(db, arrived.map(l => l.id), authorFiler)
    await matchWaitingReceipts(db)
    const waiting = Number((await one(db, 'SELECT COUNT(*) AS n FROM pt_feed_pending p JOIN pt_feed_accounts f ON f.id = p.feed_account_id WHERE f.item_id = ?', itemId))?.n ?? 0)
    await run(db, [q('UPDATE pt_feed_syncs SET finished_at = ?, added = ?, updated = ?, removed = ?, pending = ?, filed = ? WHERE id = ?', now(), arrived.length, counts.updated, counts.removed, waiting, filed.filed, syncId)])
    await checkFeedHealth(env)
    return { claimed: true, added: arrived.length, updated: counts.updated, removed: counts.removed, pending: waiting, filed: filed.filed }
  } catch (e) {
    const plaidError = e instanceof PlaidError ? e : null
    const code = plaidError?.code ?? 'ERROR', message = plaidError ? (plaidError.display || plaidError.message) : String((e as Error)?.message ?? e)
    if (plaidError?.relink) await release("status = 'relink', error_code = ?, error_message = ?, last_sync_error = ?", code, relinkMessage(code, plaidError.display), message)
    else await release('last_sync_error = ?, sync_due_at = ?', message, later(RETRY_MS))
    await run(db, [q('UPDATE pt_feed_syncs SET finished_at = ?, error_code = ? WHERE id = ?', now(), code, syncId)])
    await checkFeedHealth(env)
    if (!plaidError) throw e
    return { claimed: true, error: code, message }
  }
}

/** Sync connections whose time has come, at most `limit`, for the Cron trigger and ordinary requests. */
export async function runDue(env: Bindings, limit = 3) {
  await checkFeedHealth(env)
  if (!availability(env).available) return []
  const due = await all<{ id: string }>(env.DB, "SELECT id FROM pt_feed_items WHERE status = 'active' AND sync_due_at <= ? AND (claim_until IS NULL OR claim_until < ?) ORDER BY sync_due_at LIMIT ?", now(), now(), limit)
  const out = []
  for (const d of due) out.push(await syncItem(env, d.id, 'schedule'))
  return out
}

/** Cheap check an ordinary request makes before handing due work to waitUntil. */
export async function anyDue(env: Bindings) {
  if (!availability(env).available) return false
  return !!(await one(env.DB, "SELECT 1 FROM pt_feed_items WHERE status = 'active' AND sync_due_at <= ? AND (claim_until IS NULL OR claim_until < ?) LIMIT 1", now(), now()))
}
