// The demo's live feeds: Chase (checking and savings) connected and current, and an
// American Express card that needs the owner to sign in again. Checking and card
// lines are this month's, after the open statement, so the reconciliation story is
// unchanged; savings has no open statement, and its unexplained transfer is old
// enough for the books agent to ask about. The Adobe rule files its line, and Cedar
// Studio's ACH meets its invoice, through Pantry's own rule and deposit code, as a sync would; the demo calls no provider, so its
// connections hold no token.
import { relinkMessage } from '../pantry/feeds/plaid'
import { addDays } from '../pantry/core'
import { applyRules, authorFiler } from '../pantry/rules'
import { matchDeposits } from '../pantry/automatch'
import { demoId as id, records, thisMonth } from './records'
import { payoutNet } from './stripe'

const NO_TOKEN = 'synthetic-demo-connection-with-no-provider-token'

export async function seedFeeds(db: D1Database, { ownerEmail, now, checkingBalance, savingsBalance }: { ownerEmail: string; now: Date; checkingBalance: number; savingsBalance: number }) {
  const r = records(db), at = now.toISOString(), today = at.slice(0, 10), monthStart = `${today.slice(0, 7)}-01`
  const daysAgo = (n: number) => thisMonth(today, n)
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000).toISOString()
  r.add('pt_accounts', { id: id('2110'), code: '2110', name: 'Business card', type: 'liability', subtype: 'bank', revision: id('2110') })
  r.add('pt_bank_accounts', { id: id('card'), name: 'Business card', account_id: id('2110'), institution: 'American Express', number_last4: '1009', opening_date: monthStart, opening_cents: 0, revision: id('card') })

  const lines = [
    ['dana-cedar', 'checking', daysAgo(12), -125000, 'ACH DEBIT DANA RUIZ PHOTO', 'Dana Ruiz Photography'],
    ['cedar-ach', 'checking', daysAgo(7), 120000, 'CEDAR STUDIO ACH PMT INV-0224', 'Cedar Studio'],
    ['dana-menu', 'checking', daysAgo(5), -140000, 'ACH DEBIT DANA RUIZ PHOTO', 'Dana Ruiz Photography'],
    ['stripe', 'checking', daysAgo(3), payoutNet, 'STRIPE TRANSFER ST-J8Q2X4', 'Stripe'],
    ['adobe', 'checking', daysAgo(1), -5999, 'ADOBE *CREATIVE CLOUD', 'Adobe'],
    ['depot', 'card', daysAgo(3), -31248, 'HOME DEPOT #6512', 'Home Depot'],
    ['transfer', 'savings', addDays(today, -20), -200000, 'ONLINE TRANSFER TO CHK ...9934', ''],
  ] as const
  const moved = (bank: string) => lines.filter(l => l[1] === bank).reduce((s, l) => s + l[3], 0)
  const items = [
    { key: 'chase', name: 'Chase', status: 'active', code: '', synced: minutesAgo(12),
      accounts: [['checking', 'Operating checking', '4821', 'depository checking', checkingBalance + moved('checking')], ['savings', 'Savings', '7730', 'depository savings', savingsBalance + moved('savings')]] },
    { key: 'amex', name: 'American Express', status: 'relink', code: 'ITEM_LOGIN_REQUIRED', synced: minutesAgo(3 * 24 * 60),
      accounts: [['card', 'Business card', '1009', 'credit credit card', -moved('card')]] },
  ] as const
  for (const it of items) {
    r.add('pt_feed_items', { id: id(`feed-${it.key}`), provider: 'plaid', item_id: id(`item-${it.key}`), institution_name: it.name, access_token: NO_TOKEN, status: it.status,
      error_code: it.code, error_message: it.code ? relinkMessage(it.code) : '', sync_due_at: at, last_sync_at: it.synced, connected_by: ownerEmail, connected_at: `${monthStart}T09:00:00.000Z`, revision: id(`feed-${it.key}`) })
    for (const [bank, name, mask, kind, balance] of it.accounts)
      r.add('pt_feed_accounts', { id: id(`feed-account-${bank}`), item_id: id(`feed-${it.key}`), provider_account_id: id(`provider-${bank}`), name, mask, kind, bank_account_id: id(bank), balance_cents: balance, last_synced_at: it.synced, revision: id(`feed-account-${bank}`) })
  }
  for (const [key, bank, date, amount, description, payee] of lines)
    r.add('pt_bank_lines', { id: id(`feed-line-${key}`), bank_account_id: id(bank), posted_date: date, amount_cents: amount, description, fingerprint: `plaid:${id(key)}`, source: 'feed', payee, feed_txn_id: id(`txn-${key}`), arrived_at: at })
  r.sql('INSERT INTO pt_feed_pending (feed_txn_id, feed_account_id, txn_date, amount_cents, description, payee, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', id('txn-coffee'), id('feed-account-card'), today, -1840, 'SQ *BLUE BOTTLE COFFEE', 'Blue Bottle Coffee', at)
  r.add('pt_bank_rules', { id: id('rule-adobe'), name: 'Adobe', position: 1, direction: 'out', payee: 'Adobe', splits: JSON.stringify([{ accountId: id('6200'), share: 10000 }]), created_by: ownerEmail, created_at: at, revision: id('rule-adobe') })
  await r.save()
  // In a sync's order: Cedar Studio's ACH names its invoice, so Pantry records the payment and matches it; then the rules file.
  const arrived = lines.map(([key]) => id(`feed-line-${key}`))
  await matchDeposits(db, arrived)
  await applyRules(db, arrived, authorFiler)
}
