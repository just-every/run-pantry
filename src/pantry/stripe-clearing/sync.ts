import type { Bindings } from '../../auth.server'
import { Fault, uid, type Data } from '../core'
import { all, one, q, run } from '../db'
import { splitPayout } from '../payout-split'
import { stripeCall } from '../stripe-api'
import { payoutRow } from '../payouts'
import { balanceCents, isPayout, listAll, objectId } from './provider'
import { confirmInvoices, postItem } from './posting'
import { hold, observe, snapshot } from './store'

/** Reconcile prior payout recognition without altering any immutable journal entries. */
async function coverLegacy(db: D1Database, s: Data, key: string, scan: string, globalIds: Set<string>) {
  const reasons: string[] = []
  for (const payout of await all(db, "SELECT * FROM pt_stripe_payouts WHERE status = 'booked' AND clearing_mode = 'legacy'")) {
    if (!payout.entry_id || !await one(db, "SELECT id FROM pt_journal_entries WHERE id = ? AND status = 'posted'", payout.entry_id)) {
      reasons.push(`Legacy payout ${payout.id} has no posted journal entry; review its coverage before importing new sales.`)
      continue
    }
    const list = await listAll(key, '/balance_transactions', { payout: payout.id, expand: ['data.source'] })
    const constituents = list.items.filter(bt => !isPayout(bt))
    if (!list.complete || constituents.reduce((sum, bt) => sum + Number(bt.net), 0) !== payout.amount_cents || constituents.some(bt => bt.currency !== payout.currency)) {
      reasons.push(`Legacy payout ${payout.id} has no complete matching constituent inventory; no new sales will be posted until its coverage is known.`)
      continue
    }
    for (const bt of list.items) {
      await observe(db, s.account_id, bt, globalIds.has(bt.id) ? scan : `payout-only:${scan}`, payout.id)
      await run(db, [q("UPDATE pt_stripe_clearing_items SET status = 'legacy-covered', entry_id = ?, reason = '' WHERE id = ? AND entry_id IS NULL", payout.entry_id, bt.id)])
    }
    // Some Stripe responses omit the payout debit from the filtered itemization.
    await run(db, [q("UPDATE pt_stripe_clearing_items SET status = 'legacy-covered', entry_id = ?, reason = '' WHERE payout_id = ? AND account_id = ? AND entry_id IS NULL", payout.entry_id, payout.id, s.account_id)])
  }
  return reasons
}

export async function syncClearing(env: Bindings, db: D1Database, s: Data, key: string) {
  const scan = uid(), counts = { read: 0, booked: 0, held: 0 }, reasons: string[] = []
  let provider: number | null = null, complete = false
  try {
    const inventory = await listAll(key, '/balance_transactions', { expand: ['data.source'] })
    const ids = new Set(inventory.items.map(bt => String(bt.id)))
    for (const bt of inventory.items) await observe(db, s.account_id, bt, scan)
    if (!inventory.complete) reasons.push(inventory.reason)
    const legacyReasons = await coverLegacy(db, s, key, scan, ids)
    reasons.push(...legacyReasons)
    const invoiceErrors = await confirmInvoices(env, db)
    if (invoiceErrors.length) reasons.push(`Checkout sessions ${invoiceErrors.join(', ')} could not be confirmed; review their invoice receipts.`)
    const balance = (await one(db, 'SELECT account_id FROM pt_bank_accounts WHERE id = ?', s.bank_account_id))!
    const bank = (await one(db, 'SELECT account_id FROM pt_bank_accounts WHERE id = ?', s.payout_bank_account_id))!
    if (legacyReasons.length) for (const bt of inventory.items) await hold(db, bt.id, `Waiting for legacy payout coverage: ${legacyReasons.join(' ')}`)
    if (!legacyReasons.length) for (const bt of [...inventory.items].sort((a, b) => Number(a.created) - Number(b.created))) {
      await postItem(db, s, bt, balance.account_id, bank.account_id, invoiceErrors)
    }
    const payouts = await listAll(key, '/payouts', { status: 'paid', arrival_date: { gte: Math.floor(Date.parse(s.payouts_from + 'T00:00:00Z') / 1000) } })
    if (!payouts.complete) reasons.push(payouts.reason)
    const recorded = new Set<string>((await all(db, "SELECT payment_intent FROM pt_stripe_payments WHERE status = 'succeeded'")).map(p => p.payment_intent))
    for (const payout of payouts.items) {
      const prior = await one(db, 'SELECT * FROM pt_stripe_payouts WHERE id = ?', payout.id)
      if (prior?.status === 'booked') continue
      counts.read++
      const items = payout.automatic ? await listAll(key, '/balance_transactions', { payout: payout.id, expand: ['data.source'] }) : { items: [], complete: true, reason: '' }
      if (!items.complete) reasons.push(items.reason)
      for (const bt of items.items) {
        await observe(db, s.account_id, bt, ids.has(bt.id) ? scan : `payout-only:${scan}`, payout.id)
        if (!ids.has(bt.id)) await hold(db, bt.id, `Stripe item ${bt.id} appears in payout ${payout.id} but is missing from the independent balance-transaction inventory.`)
      }
      const split = splitPayout(payout, items.items, recorded)
      const payoutBt = inventory.items.find(bt => bt.id === objectId(payout.balance_transaction)) ?? inventory.items.find(bt => isPayout(bt) && objectId(bt.source) === payout.id && bt.type === 'payout')
      const posted = payoutBt ? await one(db, 'SELECT * FROM pt_stripe_clearing_items WHERE id = ?', payoutBt.id) : null
      const reason = !items.complete ? items.reason : split.currency !== 'usd' ? `This payout is in ${split.currency.toUpperCase()}; Pantry keeps US-dollar books.` : !split.ok ? split.reason : !posted ? `Stripe payout balance transaction ${objectId(payout.balance_transaction) ?? payout.id} is missing from the provider inventory.` : !['posted', 'legacy-covered'].includes(posted.status) ? posted.reason || 'The payout transfer is not posted.' : ''
      await run(db, [payoutRow(payout, split, reason ? split.currency === 'usd' ? 'held' : 'other-currency' : 'booked', reason, posted?.entry_id ?? null)])
      if (reason) counts.held++; else counts.booked++
    }
    provider = balanceCents(await stripeCall(key, 'GET', '/balance'))
    if (provider === null) reasons.push('Stripe did not return a valid USD available plus pending balance.')
    complete = inventory.complete && payouts.complete && !reasons.length
  } catch (error) {
    reasons.push(error instanceof Fault ? error.message : String((error as Error)?.message ?? error))
  }
  await snapshot(db, s, scan, provider, complete, reasons.join(' '))
  return { ...counts, error: reasons.join(' ') }
}
