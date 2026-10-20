import type { Data } from '../core'
import { all, one } from '../db'

/** Recompute against today's posted journal, including manual corrections and reversals. */
export async function clearingState(db: D1Database): Promise<Data | null> {
  let s = await one(db, `SELECT s.account_id AS provider_account, s.payouts_error, b.account_id AS ledger_id, a.name FROM pt_stripe s
    JOIN pt_bank_accounts b ON b.id = s.bank_account_id JOIN pt_accounts a ON a.id = b.account_id WHERE s.id = 1 AND s.payout_bank_account_id IS NOT NULL`)
  const connected = !!s
  const snap = s ? await one(db, 'SELECT * FROM pt_stripe_clearing_snapshot WHERE account_id = ?', s.provider_account)
    : await one(db, 'SELECT * FROM pt_stripe_clearing_snapshot ORDER BY observed_at DESC LIMIT 1')
  if (!s && !snap) return null
  if (!s) s = { provider_account: snap!.account_id, ledger_id: snap!.ledger_account_id, name: snap!.account_name, payouts_error: '' }
  const ledger = await one(db, `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS cents FROM pt_journal_lines l
    JOIN pt_journal_entries e ON e.id = l.entry_id WHERE l.account_id = ? AND e.status = 'posted'`, s.ledger_id)
  const rows = await all(db, `SELECT i.*, e.status AS entry_status, e.reversed_by_id, f.status AS fee_status, f.reversed_by_id AS fee_reversed
    FROM pt_stripe_clearing_items i LEFT JOIN pt_journal_entries e ON e.id = i.entry_id
    LEFT JOIN pt_journal_entries f ON f.id = i.fee_entry_id WHERE i.account_id = ? ORDER BY i.event_date, i.id`, s.provider_account)
  const items = rows.map(r => {
    let status = r.status, reason = r.reason
    if (snap?.complete && r.seen_scan !== snap.scan_id) { status = 'missing-provider'; reason = 'Previously observed Stripe item is missing from the complete provider inventory.' }
    else if (r.entry_id && (r.entry_status !== 'posted' || r.reversed_by_id)) { status = 'held'; reason = 'The associated journal entry is missing, unposted or reversed; review this Stripe item.' }
    else if (r.fee_entry_id && (r.fee_status !== 'posted' || r.fee_reversed)) { status = 'held'; reason = 'The invoice fee entry is missing, unposted or reversed; review this Stripe item.' }
    else if (reason) status = 'held'
    return { id: r.id, type: r.type, date: r.event_date, amountCents: r.amount_cents, netCents: r.net_cents, status, reason, entryId: r.entry_id, payoutId: r.payout_id, sourceId: r.source_id }
  })
  const providerCents = snap?.provider_cents ?? null, ledgerCents = Number(ledger?.cents ?? 0)
  const differenceCents = providerCents === null ? null : ledgerCents - providerCents
  const complete = connected && !!snap?.complete && !s.payouts_error
  const exceptions = items.filter(i => !['posted', 'adopted', 'legacy-covered'].includes(i.status))
  const reason = !connected ? 'Retained Stripe reconciliation history; reconnect and configure Stripe before checking the current provider balance.' : s.payouts_error || snap?.reason || (!snap ? 'Stripe balance has not been read yet.' : !complete ? 'The Stripe provider inventory is incomplete.' : exceptions.length ? `${exceptions.length} Stripe item${exceptions.length === 1 ? '' : 's'} need review.` : providerCents === null ? 'Stripe did not provide a valid USD balance.' : differenceCents ? `Stripe balance differs from the ledger by ${differenceCents} cents; review missing provider items or historical opening activity.` : '')
  return { account: { id: s.ledger_id, name: s.name }, observedAt: snap?.observed_at ?? null, providerCents, ledgerCents, differenceCents, complete,
    ok: complete && providerCents !== null && differenceCents === 0 && exceptions.length === 0, reason, items }
}
