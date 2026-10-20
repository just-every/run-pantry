import { requireThat } from './core'
import { guard, type Sql } from './db'
import { clearingState } from './stripe-clearing'

/** A concurrent sync, posting or reversal cannot invalidate a close's checked tie. */
export async function clearingCloseGuards(db: D1Database): Promise<Sql[]> {
  const state = await clearingState(db)
  if (!state) return []
  requireThat(state.ok, 'Resolve the Stripe clearing difference before locking', 409)
  return [guard(`EXISTS (SELECT 1 FROM pt_stripe_clearing_snapshot s WHERE s.ledger_account_id = ? AND s.observed_at = ? AND s.complete = 1 AND s.provider_cents = ?
    AND s.provider_cents = (SELECT COALESCE(SUM(l.debit_cents-l.credit_cents),0) FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id WHERE e.status='posted' AND l.account_id=s.ledger_account_id)
    AND NOT EXISTS (SELECT 1 FROM pt_stripe_clearing_items i LEFT JOIN pt_journal_entries e ON e.id=i.entry_id LEFT JOIN pt_journal_entries f ON f.id=i.fee_entry_id WHERE i.account_id=s.account_id
      AND (i.status NOT IN ('posted','adopted','legacy-covered') OR i.reason <> '' OR i.seen_scan <> s.scan_id OR (i.entry_id IS NOT NULL AND (e.status IS NOT 'posted' OR e.reversed_by_id IS NOT NULL)) OR (i.fee_entry_id IS NOT NULL AND (f.status IS NOT 'posted' OR f.reversed_by_id IS NOT NULL)))))`, state.account.id, state.observedAt, state.providerCents)]
}
