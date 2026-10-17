// This month's money moments, each through Pantry's own code: the contractor's
// ACH payments recorded against her bills and matched to their feed lines; the
// Stripe payout split by Pantry's payout split and matched to its deposit; the
// recurring invoice's occurrences created by its due work, then approved and
// issued; and the invoice sent and viewed. Only a provider's answers are seeded
// as records (Stripe's payout listing, the mail provider's acceptance and the
// customer opening the page), because the demo calls no provider.
import type { Bindings } from '../auth.server'
import { pantry, type Person } from '../pantry/access'
import { accountInsert } from '../pantry/accounts'
import { longDay, sha256, usd } from '../pantry/core'
import { all, approval, audit, one, q, run } from '../pantry/db'
import { ensureLink, invoiceDocument } from '../pantry/delivery'
import { invoicePdf } from '../pantry/invoice-pdf'
import { invoice, issueStatements, type Issuable } from '../pantry/invoices'
import { matchPlan } from '../pantry/matching'
import { paymentStatements } from '../pantry/payables'
import { splitPayout } from '../pantry/payout-split'
import { bookStatements, matchPayouts, payoutRow } from '../pantry/payouts'
import { runDueRecurring } from '../pantry/recurring'
import { seal } from '../pantry/stripe-api'
import { demoId as id } from './records'
import { demoPayout, PAYOUT_ID } from './stripe'

type Seed = { env: Bindings; owner: Person; reviewer: string; now: Date }

/** Dana Ruiz's two bills, paid by ACH from checking, each matched to the line the feed brought. */
export async function payContractor({ env, owner }: Seed) {
  const db = env.DB
  for (const [bill, ref] of [['dana-cedar', 'DR-114'], ['dana-menu', 'DR-121']]) {
    const line = (await one(db, 'SELECT * FROM pt_bank_lines WHERE id = ?', id(`feed-line-${bill}`)))!
    if (await one(db, 'SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1', line.id)) continue
    const amount = (-line.amount_cents / 100).toFixed(2)
    const paid = await paymentStatements(db, owner, { direction: 'paid', contactId: id('dana'), date: line.posted_date, amount, bankAccountId: id('checking'), method: 'ach', reference: ref, allocations: [{ targetId: id(bill), amount }] })
    await run(db, paid.statements)
    const posting = (await one<{ id: string }>(db, 'SELECT id FROM pt_journal_lines WHERE entry_id = ? AND account_id = ?', paid.journalId, paid.bankLedgerAccount))!
    await run(db, (await matchPlan(db, owner, { bankLineIds: [line.id], journalLineIds: [posting.id], create: [], note: `ACH to Dana Ruiz Photography, bill ${ref}` })).statements)
  }
}

/** Stripe connected for payouts into checking, and this month's payout booked and matched. */
export async function bookPayout({ env, owner, now }: Seed) {
  const db = env.DB, at = now.toISOString()
  if (await one(db, 'SELECT 1 FROM pt_stripe_payouts WHERE id = ?', PAYOUT_ID)) return
  const line = (await one(db, 'SELECT posted_date FROM pt_bank_lines WHERE id = ?', id('feed-line-stripe')))!
  await run(db, [
    accountInsert(id('1050'), { code: '1050', name: 'Stripe balance', type: 'asset', subtype: 'bank', description: 'Money collected through Stripe before it is paid out to the bank' }),
    accountInsert(id('6450'), { code: '6450', name: 'Stripe fees', type: 'expense', subtype: 'other', description: 'Card and ACH processing fees Stripe deducts' }),
    accountInsert(id('4800'), { code: '4800', name: 'Refunds and disputes', type: 'income', subtype: 'other', description: 'Customer refunds and lost disputes, which reduce sales' }),
    q("INSERT INTO pt_bank_accounts (id, name, account_id, institution, number_last4, routing, opening_date, opening_cents, revision) VALUES (?, 'Stripe balance', ?, 'Stripe', '0000', '', ?, 0, ?)", id('stripe-balance'), id('1050'), `${at.slice(0, 7)}-01`, id('stripe-balance')),
    q(`INSERT INTO pt_stripe (id, key_sealed, key_hint, livemode, account_id, account_name, settlement_currency, country, webhook_id, card, ach, bank_account_id, fee_account_id, connected_by, connected_at, revision,
        payout_bank_account_id, sales_account_id, refunds_account_id, payouts_from, payouts_synced_at) VALUES (1, ?, 'demo', 1, 'acct_demo_juniper', 'Juniper Lane Design', 'usd', 'US', 'we_demo_juniper', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      await seal(env, 'demo-connection-with-no-provider-key'), id('stripe-balance'), id('6450'), owner.email, `${at.slice(0, 7)}-01T09:30:00.000Z`, id('stripe'), id('checking'), id('4000'), id('4800'), `${at.slice(0, 7)}-01`, at),
    audit(owner, 'stripe.connect', 'stripe', '1', { account: 'acct_demo_juniper', livemode: true, webhook: true }),
  ])
  const s = (await one(db, 'SELECT * FROM pt_stripe WHERE id = 1'))!, sales = (await one(db, 'SELECT * FROM pt_accounts WHERE id = ?', id('4000')))!
  const { payout, items } = demoPayout(line.posted_date), split = splitPayout(payout, items, new Map())
  if (!split.ok) throw new Error(`Demo payout does not split: ${split.reason}`)
  const entryId = id('stripe-payout-entry')
  await run(db, [...bookStatements(s, payout, split, entryId, id('1000'), id('1050'), sales), payoutRow(payout, split, 'booked', '', entryId),
    audit(pantry('stripe'), 'stripe.payout', 'stripe-payout', payout.id, { net: split.net, gross: split.gross, fees: split.fees, refunds: split.refunds, charges: split.charges, invoiced: split.invoiced })])
  await matchPayouts(db)
}

/** Harbor Lights' monthly retainer: its due work drafts each month's invoice; Morgan approves and Priya issues it. */
export async function runRecurring({ env, owner, reviewer, now }: Seed) {
  const db = env.DB
  await runDueRecurring(env, db, now.toISOString().slice(0, 10))
  for (const { invoice_id } of await all<{ invoice_id: string }>(db, "SELECT r.invoice_id FROM pt_recurring_runs r JOIN pt_invoices i ON i.id = r.invoice_id WHERE r.recurring_id = ? AND i.status = 'draft' ORDER BY r.occurrence", id('recurring-harbor'))) {
    const draft = await invoice(db, invoice_id), revision = `${draft.revision}-approved`
    await run(db, [approval({ email: reviewer, kind: 'person' }, 'invoice', draft.id, draft.revision, 'approve', 'approved', 'Same scope as the retainer agreement.'),
      q("UPDATE pt_invoices SET status = 'approved', approved_by = ?, approved_revision = ?, revision = ? WHERE id = ? AND status = 'draft'", reviewer, revision, revision, draft.id),
      audit({ email: reviewer, kind: 'person' }, 'invoice.approve', 'invoice', draft.id)])
    await run(db, (await issueStatements(db, await invoice(db, draft.id) as Issuable, owner, draft.prepared_by)).statements)
  }
}

/** The Northstar invoice: emailed with its PDF (the provider accepted it) and opened by the customer two days later. */
export async function sendInvoice({ env, owner, now }: Seed) {
  const db = env.DB, inv = await invoice(db, id('northstar-phase2'))
  if (inv.sent_at) return
  await ensureLink(db, inv.id)
  const doc = await invoiceDocument(db, inv), sent = `${inv.issue_date}T15:02:00.000Z`
  const viewed = new Date(Math.min(Date.parse(sent) + 2 * 86400000 + 3 * 3600000, now.getTime() - 3600000)).toISOString()
  const subject = `Invoice ${inv.number} from ${doc.business}: ${usd(inv.open_cents)} due ${longDay(inv.due_date)}`
  await run(db, [
    q("INSERT INTO pt_deliveries (id, invoice_id, kind, step, recipient, subject, status, attachment_sha256, sent_by, at, provider, provider_message_id, detail, finished_at) VALUES (?, ?, 'invoice', NULL, ?, ?, 'accepted', ?, ?, ?, 'demo', NULL, '', ?)",
      id('delivery-northstar'), inv.id, inv.customer_email, subject, await sha256(invoicePdf(doc)), owner.email, sent, sent),
    q('UPDATE pt_invoices SET sent_at = ?, viewed_at = ? WHERE id = ?', sent, viewed, inv.id),
    q("INSERT INTO pt_audit (id, at, actor_email, actor_kind, action, subject_kind, subject_id, detail) VALUES (?, ?, ?, 'person', 'invoice.send', 'invoice', ?, ?)", id('audit-send'), sent, owner.email, inv.id, JSON.stringify({ recipient: inv.customer_email, status: 'accepted', step: null })),
    q("INSERT INTO pt_audit (id, at, actor_email, actor_kind, action, subject_kind, subject_id, detail) VALUES (?, ?, 'pantry:customer', 'system', 'invoice.viewed', 'invoice', ?, '{}')", id('audit-viewed'), viewed, inv.id),
  ])
}
