// Stripe payouts, booked by themselves. Once the owner says which bank account
// payouts land in and where sales go, Pantry reads each paid payout from the
// business's own Stripe account with the balance transactions inside it, posts
// one entry splitting it into gross sales, Stripe fees and refunds against the
// bank deposit of the net amount, and matches that deposit when its bank line
// arrives. A payout is booked once however often it is read again.
import type { Bindings } from '../auth.server'
import { authority, pantry, who } from './access'
import { date, Fault, now, requireThat, text, uid, usd, type Data } from './core'
import { all, audit, changed, one, q, run, type Sql } from './db'
import { accountInsert } from './accounts'
import { entryStatements } from './journal'
import { nextCode, stripeSettings, syncCheckout } from './stripe'
import { managedInstall, stripeCall, unseal } from './stripe-api'
import { splitPayout, type Recorded, type Split } from './payout-split'
import { entryMatch, matchEntry } from './provider-match'
import type { Command } from './context'

const EVERY_MS = 6 * 3600_000, LEASE_MS = 5 * 60_000
const MAX_PAGES = 10
const dayOf = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10)
const epochOf = (day: string) => Math.floor(Date.parse(day + 'T00:00:00Z') / 1000)

export const PAYOUTS_MANAGED = 'Stripe payouts are not available yet on RER Managed: managed installs cannot reach Stripe until RER adds a provider relay.'

/** Every page of a Stripe list. */
async function listAll(key: string, path: string, params: Data) {
  const out: Data[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await stripeCall(key, 'GET', path, { limit: 100, ...params, ...(after ? { starting_after: after } : {}) })
    out.push(...r.data)
    if (!r.has_more || !r.data.length) break
    after = r.data.at(-1).id
  }
  return out
}

const configure: Command = { need: 'owner', async run(c, b) {
  requireThat(!managedInstall(c.env), PAYOUTS_MANAGED, 409)
  const s = await stripeSettings(c.db)
  requireThat(s, 'Connect Stripe first', 409)
  const bank = await one(c.db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', text(b.bankAccountId, 'Bank account payouts land in'))
  requireThat(bank && bank.id !== s.bank_account_id, 'Choose the bank account Stripe pays out to')
  const sales = await one(c.db, 'SELECT * FROM pt_accounts WHERE id = ?', text(b.salesAccountId, 'Sales account'))
  requireThat(sales && sales.active && sales.type === 'income', 'Choose an income account for sales through Stripe')
  const from = date(b.from, 'Book payouts arriving from')
  const statements: Sql[] = [authority(c.actor, 'owner')]
  let refunds = s.refunds_account_id
  if (!refunds) {
    refunds = uid()
    statements.push(accountInsert(refunds, { code: await nextCode(c.db, 4800), name: 'Refunds and disputes', type: 'income', subtype: 'other', description: 'Customer refunds and lost disputes, which reduce sales' }))
  }
  statements.push(q('UPDATE pt_stripe SET payout_bank_account_id = ?, sales_account_id = ?, refunds_account_id = ?, payouts_from = ?, revision = ? WHERE id = 1', bank.id, sales.id, refunds, from, uid()), changed(),
    audit(who(c.actor), 'stripe.payouts', 'stripe', '1', { bankAccount: bank.name, sales: `${sales.code} ${sales.name}`, from }))
  await run(c.db, statements)
  return { sync: await syncPayouts(c.env, c.db), payouts: await payoutsView(c.env, c.db) }
} }

const syncNow: Command = { need: 'record', async run(c) {
  requireThat(!managedInstall(c.env), PAYOUTS_MANAGED, 409)
  const s = await stripeSettings(c.db)
  requireThat(s?.payout_bank_account_id, 'Choose where Stripe payouts land first', 409)
  const sync = await syncPayouts(c.env, c.db)
  requireThat(sync.claimed, 'Payouts are already being read; try again in a minute', 409)
  return { sync, payouts: await payoutsView(c.env, c.db) }
} }

export const payoutCommands: Record<string, Command> = {
  'stripe.payouts': configure,
  'stripe.payouts-sync': syncNow,
}

/** Invoice-link payments inside these charges, confirmed first so a sale is never booked twice. */
async function recordedPayments(env: Bindings, db: D1Database, intents: string[]) {
  const known = new Map<string, Recorded>(), waiting: string[] = []
  if (!intents.length) return { known, waiting }
  const marks = intents.map(() => '?').join(',')
  for (const p of await all(db, `SELECT id FROM pt_stripe_payments WHERE status <> 'succeeded' AND payment_intent IN (${marks})`, ...intents)) await syncCheckout(env, db, p.id)
  for (const p of await all(db, `SELECT payment_intent, status, fee_entry_id FROM pt_stripe_payments WHERE payment_intent IN (${marks})`, ...intents)) {
    if (p.status === 'succeeded') known.set(p.payment_intent, { feeBooked: !!p.fee_entry_id })
    else waiting.push(p.payment_intent)
  }
  return { known, waiting }
}

export function bookStatements(s: Data, payout: Data, split: Split, entryId: string, bankLedger: string, balanceLedger: string, sales: Data): Sql[] {
  const id = String(payout.id), lines = [
    { accountId: bankLedger, signed: split.lines.bank, memo: `Stripe payout · ${id}` },
    { accountId: s.fee_account_id, signed: split.lines.fees, memo: `Stripe fees on ${split.charges} charge${split.charges === 1 ? '' : 's'}` },
    { accountId: s.refunds_account_id, signed: split.lines.refunds, memo: `Refunds and disputes (${split.refundCount})` },
    { accountId: sales.id, signed: split.lines.sales, memo: `Gross sales through Stripe` },
    { accountId: balanceLedger, signed: split.lines.balance, memo: 'Invoice payments already recorded from the invoice link' },
  ].filter(l => l.signed !== 0).map(l => ({ accountId: l.accountId, debit: Math.max(l.signed, 0), credit: Math.max(-l.signed, 0), memo: l.memo }))
  const by = pantry('stripe').email
  return [
    ...entryStatements({ id: entryId, date: dayOf(payout.arrival_date), memo: `Stripe payout ${id}: ${split.charges} charge${split.charges === 1 ? '' : 's'}, fees split`, sourceKind: 'bank', sourceId: id, preparedBy: by, preparedKind: 'import', lines }, by),
    ...split.feesFor.flatMap(f => [q('UPDATE pt_stripe_payments SET fee_cents = ?, fee_entry_id = ?, updated_at = ? WHERE payment_intent = ? AND fee_entry_id IS NULL', f.fee, entryId, now(), f.intent), changed()]),
  ]
}

export const payoutRow = (payout: Data, split: Split, status: string, reason: string, entryId: string | null) =>
  q(`INSERT INTO pt_stripe_payouts (id, arrival_date, currency, amount_cents, gross_cents, invoiced_cents, fee_cents, refund_cents, charges, refunds, status, reason, entry_id, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET gross_cents = excluded.gross_cents, invoiced_cents = excluded.invoiced_cents, fee_cents = excluded.fee_cents, refund_cents = excluded.refund_cents, charges = excluded.charges, refunds = excluded.refunds, status = excluded.status, reason = excluded.reason, entry_id = excluded.entry_id, read_at = excluded.read_at
    WHERE pt_stripe_payouts.status <> 'booked'`,
    payout.id, dayOf(payout.arrival_date), split.currency, split.net, split.gross, split.invoiced, split.fees, split.refunds, split.charges, split.refundCount, status, reason, entryId, now())

/** Read paid payouts from Stripe and book each one not yet booked. One reader at a time. */
export async function syncPayouts(env: Bindings, db: D1Database) {
  const claim = await db.prepare('UPDATE pt_stripe SET payouts_claim_until = ? WHERE id = 1 AND payout_bank_account_id IS NOT NULL AND (payouts_claim_until IS NULL OR payouts_claim_until < ?)').bind(new Date(Date.now() + LEASE_MS).toISOString(), now()).run()
  if (claim.meta.changes !== 1) return { claimed: false }
  const counts = { read: 0, booked: 0, held: 0, matched: 0 }
  let error = ''
  try {
    const s = (await stripeSettings(db))!, key = await unseal(env, s.key_sealed)
    const bank = (await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', s.payout_bank_account_id))!
    const balance = (await one(db, 'SELECT account_id FROM pt_bank_accounts WHERE id = ?', s.bank_account_id))!
    const sales = (await one(db, 'SELECT * FROM pt_accounts WHERE id = ?', s.sales_account_id))!
    // Booked payouts, and those in another currency, are settled; held ones are read again.
    const booked = new Set((await all<{ id: string }>(db, "SELECT id FROM pt_stripe_payouts WHERE status IN ('booked', 'other-currency')")).map(r => r.id))
    const payouts = (await listAll(key, '/payouts', { status: 'paid', arrival_date: { gte: epochOf(s.payouts_from) } })).filter(p => !booked.has(p.id)).reverse()
    for (const payout of payouts) {
      counts.read++
      const items = payout.automatic ? await listAll(key, '/balance_transactions', { payout: payout.id, expand: ['data.source'] }) : []
      const intents = items.filter(t => (t.reporting_category ?? t.type) === 'charge').map(t => typeof t.source === 'object' ? t.source?.payment_intent : null).filter((x): x is string => typeof x === 'string')
      const { known, waiting } = await recordedPayments(env, db, intents)
      const split = splitPayout(payout, items, known)
      if (split.currency !== 'usd') {
        await run(db, [payoutRow(payout, split, 'other-currency', `This payout is in ${split.currency.toUpperCase()}. Pantry keeps US-dollar books, so it books payouts only from a Stripe account that pays out in US dollars.`, null)])
        counts.held++; continue
      }
      const reason = !split.ok ? split.reason : waiting.length ? `Waiting for Pantry to confirm ${waiting.length} invoice payment${waiting.length === 1 ? '' : 's'} inside it with Stripe.` : ''
      if (reason) { await run(db, [payoutRow(payout, split, 'held', reason, null)]); counts.held++; continue }
      const entryId = uid()
      try {
        await run(db, [...bookStatements(s, payout, split, entryId, bank.account_id, balance.account_id, sales), payoutRow(payout, split, 'booked', '', entryId), changed(),
          audit(pantry('stripe'), 'stripe.payout', 'stripe-payout', payout.id, { net: split.net, gross: split.gross, fees: split.fees, refunds: split.refunds, charges: split.charges, invoiced: split.invoiced })])
        counts.booked++
      } catch (e) {
        if (!(e instanceof Fault)) throw e
        // Booked by another reader meanwhile, or the period is locked: say why it waits.
        if ((await one(db, 'SELECT status FROM pt_stripe_payouts WHERE id = ?', payout.id))?.status === 'booked') continue
        await run(db, [payoutRow(payout, split, 'held', e.message, null)]); counts.held++
      }
    }
    counts.matched = await matchPayouts(db)
  } catch (e) {
    error = e instanceof Fault ? e.message : String((e as Error)?.message ?? e)
    if (!(e instanceof Fault)) console.error('Pantry Stripe payouts failed:', e)
  }
  await run(db, [q('UPDATE pt_stripe SET payouts_synced_at = ?, payouts_error = ?, payouts_claim_until = NULL WHERE id = 1', now(), error)])
  return { claimed: true, ...counts, error }
}

/** Booked payouts whose deposit has not been matched yet, matched where one bank line fits. */
export async function matchPayouts(db: D1Database) {
  const s = await one(db, 'SELECT payout_bank_account_id FROM pt_stripe WHERE id = 1')
  if (!s?.payout_bank_account_id) return 0
  const open = await all(db, `SELECT p.id, p.arrival_date, p.amount_cents, p.entry_id FROM pt_stripe_payouts p WHERE p.status = 'booked' AND p.arrival_date >= ?
    AND NOT EXISTS (SELECT 1 FROM pt_journal_lines l JOIN pt_match_postings m ON m.journal_line_id = l.id WHERE l.entry_id = p.entry_id)`, new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10))
  let matched = 0
  for (const p of open) if (await matchEntry(db, { entryId: p.entry_id, bankAccountId: s.payout_bank_account_id, day: p.arrival_date, before: 1, after: 4, hint: /stripe/i, note: `Matched automatically: Stripe payout ${p.id} of ${usd(p.amount_cents)}` })) matched++
  return matched
}

/** Due work: read payouts every few hours. */
export async function syncDuePayouts(env: Bindings, db: D1Database) {
  if (managedInstall(env)) return
  const s = await one(db, 'SELECT payout_bank_account_id, payouts_synced_at FROM pt_stripe WHERE id = 1')
  if (!s?.payout_bank_account_id || (s.payouts_synced_at && Date.parse(s.payouts_synced_at) > Date.now() - EVERY_MS)) return
  await syncPayouts(env, db)
}

export async function payoutsView(env: Bindings, db: D1Database) {
  if (managedInstall(env)) return { available: false, reason: PAYOUTS_MANAGED }
  const s = await stripeSettings(db)
  if (!s) return { available: false, reason: 'Connect Stripe under Online payments first; payouts are read from the same account.' }
  const names = async (id: string | null) => id ? (await one(db, 'SELECT id, code, name FROM pt_accounts WHERE id = ?', id)) : null
  const bank = s.payout_bank_account_id ? await one(db, 'SELECT id, name, number_last4 FROM pt_bank_accounts WHERE id = ?', s.payout_bank_account_id) : null
  const rows = await all(db, 'SELECT * FROM pt_stripe_payouts ORDER BY arrival_date DESC, id LIMIT 50')
  return {
    available: true, currency: s.settlement_currency,
    settings: { bank, sales: await names(s.sales_account_id), refunds: await names(s.refunds_account_id), fees: await names(s.fee_account_id), from: s.payouts_from, syncedAt: s.payouts_synced_at, error: s.payouts_error },
    payouts: await Promise.all(rows.map(async r => ({ ...r, match: await entryMatch(db, r.entry_id) }))),
  }
}
