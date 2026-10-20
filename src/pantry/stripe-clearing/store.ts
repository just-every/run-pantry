import { now, type Data } from '../core'
import { q, run } from '../db'
import { categoryOf, dayOf, intentOf, isPayout, objectId } from './provider'

/** Observation happens before posting, so locks and unsupported types remain visible. */
export async function observe(db: D1Database, account: string, bt: Data, scan: string, payoutId: string | null = null) {
  const amount = Number(bt.amount), net = Number(bt.net), fee = Number(bt.fee ?? 0)
  const valid = Number.isSafeInteger(amount) && Number.isSafeInteger(net) && Number.isSafeInteger(fee)
  const eventDate = Number.isFinite(bt.created) && bt.created > 0 ? dayOf(bt.created) : null
  await run(db, [q(`INSERT INTO pt_stripe_clearing_items
    (id, account_id, type, event_date, currency, amount_cents, net_cents, fee_cents, payment_intent, source_id, payout_id, status, reason, seen_scan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET seen_scan = excluded.seen_scan, payout_id = COALESCE(excluded.payout_id, pt_stripe_clearing_items.payout_id),
    reason = CASE WHEN pt_stripe_clearing_items.amount_cents <> excluded.amount_cents OR pt_stripe_clearing_items.net_cents <> excluded.net_cents OR pt_stripe_clearing_items.fee_cents <> excluded.fee_cents OR pt_stripe_clearing_items.currency <> excluded.currency OR pt_stripe_clearing_items.event_date IS NOT excluded.event_date THEN 'Provider item changed after observation; review its posting.' ELSE CASE WHEN pt_stripe_clearing_items.entry_id IS NULL THEN excluded.reason ELSE pt_stripe_clearing_items.reason END END`,
  bt.id, account, categoryOf(bt), eventDate, String(bt.currency ?? '').toLowerCase(), valid ? amount : 0, valid ? net : 0, valid ? fee : 0,
  intentOf(bt), objectId(bt.source), payoutId ?? (isPayout(bt) ? objectId(bt.source) : null), valid && eventDate ? 'observed' : 'held', valid && eventDate ? '' : 'Stripe item has invalid amounts or no event creation time.', scan)])
}

export async function hold(db: D1Database, id: string, reason: string) {
  await run(db, [q("UPDATE pt_stripe_clearing_items SET status = 'held', reason = ? WHERE id = ? AND entry_id IS NULL", reason, id)])
}

export async function snapshot(db: D1Database, settings: Data, scan: string, provider: number | null, complete: boolean, reason: string) {
  const ledger = await db.prepare('SELECT b.account_id, a.name FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id WHERE b.id = ?').bind(settings.bank_account_id).first<Data>()
  await run(db, [q(`INSERT INTO pt_stripe_clearing_snapshot (account_id, observed_at, provider_cents, complete, reason, scan_id, ledger_account_id, account_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET observed_at = excluded.observed_at, provider_cents = excluded.provider_cents, complete = excluded.complete, reason = excluded.reason, scan_id = excluded.scan_id, ledger_account_id = excluded.ledger_account_id, account_name = excluded.account_name`, settings.account_id, now(), provider, complete ? 1 : 0, reason, scan, ledger?.account_id ?? null, ledger?.name ?? 'Stripe balance')])
}
