// CLOSE-004: the daily checks, through the Worker's public doors (Cron trigger, commands and views).
// Seeded dates count back from today, because a check judges what is old by the calendar.
import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'

const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const mdy = d => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
const dollars = cents => (cents / 100).toFixed(2)

async function world(h) {
  const { acct } = await books(h)
  const checking = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0.00' })
  const vendor = async name => (await h.command('contact.save', { kind: 'vendor', name, termsDays: 30 })).id
  const bill = (vendorId, reference, billDate, amount, account = '6200') => h.command('bill.save', { vendorId, reference, billDate, lines: [{ description: reference, accountId: acct[account], amount }], post: true })
  const journal = async (date, memo, lines) => { const d = await h.command('journal.save-draft', { date, memo, lines }); return h.command('journal.post', { id: d.id, revision: d.revision }) }
  return { acct, checking, vendor, bill, journal }
}
const flags = async h => (await h.view('continuous-checks')).flags
const open = async (h, rule) => (await flags(h)).filter(f => f.rule === rule && f.status === 'open')

test('CLOSE-004 each check flags its seeded case the next day, citing its lines, rule and setting; a dismissal holds until the lines change; the owner changes defaults', async t => {
  const h = await harness(); t.after(() => h.close())
  const w = await world(h), { acct } = w
  const suspense = await h.command('account.save', { code: '1900', name: 'Ask my accountant', type: 'asset', subtype: 'other', suspense: true })
  assert.equal((await h.view('state')).accounts.find(a => a.id === suspense.id).suspense, 1)

  // Unreconciled account: a statement that ended 60 days ago, never reconciled; its two lines arrived 10 days ago and are still unfiled.
  const csv = `Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nCREDIT,${mdy(day(75))},"DEPOSIT ACME ACH",500.00,ACH_CREDIT,500.00,\nDEBIT,${mdy(day(70))},"SERVICE FEE",-12.00,FEE_TRANSACTION,488.00,\n`
  const imported = await h.command('statement.import', { bankAccountId: w.checking.id, fileName: 'old.csv', content: csv, opening: '0.00', closing: '488.00', start: day(80), end: day(60), confirmLast4: '4821' })
  await h.db.batch([h.db.prepare('UPDATE pt_statements SET imported_at = ? WHERE id = ?').bind(`${day(10)}T09:00:00.000Z`, imported.statement.id), h.db.prepare('UPDATE pt_bank_lines SET arrived_at = ? WHERE statement_id = ?').bind(`${day(10)}T09:00:00.000Z`, imported.statement.id)])

  // Wrong side: receivables with a credit balance, a card with a debit balance.
  const customer = (await h.command('contact.save', { kind: 'customer', name: 'Cedar Studio', termsDays: 30 })).id
  await h.command('payment.record', { direction: 'received', contactId: customer, date: day(5), amount: '100.00', bankAccountId: w.checking.id })
  await w.journal(day(5), 'Card refund posted twice', [{ accountId: acct['2100'], debit: '50.00' }, { accountId: acct['1000'], credit: '50.00' }])
  // Suspense: 300.00 parked 12 days ago.
  await w.journal(day(12), 'Unknown deposit', [{ accountId: suspense.id, debit: '300.00' }, { accountId: acct['3000'], credit: '300.00' }])
  // Duplicates: same amount three days apart, and one vendor invoice number typed two ways; two payments for one amount.
  const dup = await w.vendor('Duplicate Co'), same = await w.vendor('Same Number Ltd'), template = await w.vendor('Weekly Cleaners')
  const d1 = await w.bill(dup, 'D-100', day(9), '250.00'), d2 = await w.bill(dup, 'D-101', day(6), '250.00')
  await w.bill(same, 'INV-9', day(20), '80.00'); await w.bill(same, 'inv 9', day(15), '95.00')
  const pay = date => h.command('payment.record', { direction: 'paid', contactId: dup, date, amount: '250.00', bankAccountId: w.checking.id, allocations: [{ targetId: date === day(4) ? d1.id : d2.id, amount: '250.00' }] })
  await pay(day(4)); await pay(day(2))
  // A weekly recurring template makes same-amount bills seven days apart: not a duplicate.
  await h.command('recurring-bill.save', { name: 'Cleaning', vendorId: template, startDate: day(14), unit: 'week', every: 1, lines: [{ description: 'Cleaning', accountId: acct['6100'], amount: '120.00' }] })
  await h.command('recurring-bill.generate', { through: day(1) })
  for (const draft of (await h.db.prepare("SELECT id, revision FROM pt_bills WHERE vendor_id = ? AND status = 'draft' ORDER BY bill_date").bind(template).all()).results) await h.command('bill.record', { id: draft.id, revision: draft.revision })
  assert.ok((await h.db.prepare("SELECT COUNT(*) AS n FROM pt_bills WHERE vendor_id = ? AND status = 'posted'").bind(template).first()).n >= 2, 'the template made posted same-amount bills a week apart')

  // Unusual amount: six bills between $110 and $130 (median $120), then $410, $135, $350 and a tiny one.
  const steady = await w.vendor('Steady Supplies')
  for (const [i, amount] of ['110.00', '115.00', '120.00', '120.00', '125.00', '130.00'].entries()) await w.bill(steady, `S-${i}`, day(200 - i * 10), amount)
  const high = await w.bill(steady, 'S-410', day(5), '410.00'), ok1 = await w.bill(steady, 'S-135', day(4), '135.00'), ok2 = await w.bill(steady, 'S-350', day(3), '350.00'), low = await w.bill(steady, 'S-10', day(2), '10.00')
  // A vendor with three earlier bills is never assessed; amounts that miss the $100 floor are not flagged.
  const newcomer = await w.vendor('Newcomer Inc'), pennies = await w.vendor('Pennies Co')
  for (const [i, amount] of ['110.00', '120.00', '130.00'].entries()) await w.bill(newcomer, `N-${i}`, day(150 - i * 5), amount)
  await w.bill(newcomer, 'N-900', day(3), '900.00')
  for (let i = 0; i < 4; i++) await w.bill(pennies, `P-${i}`, day(150 - i * 10), '12.00')
  await w.bill(pennies, 'P-50', day(3), '50.00'); await w.bill(pennies, 'P-tiny', day(2), '2.00')
  // Expenses count beside bills: two bills and two expenses make four postings.
  const mixed = await w.vendor('Mixed Co')
  for (const [i, amount] of ['100.00', '110.00'].entries()) await w.bill(mixed, `M-${i}`, day(120 - i * 5), amount)
  for (const [i, amount] of ['105.00', '95.00'].entries()) await w.journal(day(100 - i * 5), `Card purchase ${i}`, [{ accountId: acct['6300'], debit: amount, contactId: mixed }, { accountId: acct['1000'], credit: amount }])
  await w.bill(mixed, 'M-900', day(3), '900.00')

  // Nothing is flagged until the daily run; the Cron trigger is that run.
  assert.deepEqual((await h.view('continuous-checks')).flags.filter(f => f.status === 'open' && f.rule === 'unreconciled'), [])
  await h.cron()
  const view = await h.view('continuous-checks')
  const byRule = rule => view.flags.filter(f => f.rule === rule && f.status === 'open')

  const unreconciled = byRule('unreconciled'); assert.equal(unreconciled.length, 1)
  assert.deepEqual(unreconciled[0].lines.map(l => [l.kind, l.id]), [['statement', imported.statement.id]]); assert.deepEqual(unreconciled[0].setting, { unreconciledDays: 45 })
  const stale = byRule('stale-queue'); assert.equal(stale.length, 1); assert.equal(stale[0].lines.length, 2); assert.deepEqual(stale[0].setting, { staleQueueDays: 7 })
  assert.deepEqual(byRule('wrong-side').map(f => f.title.split(' has ')[0]).sort(), ['1200 Accounts receivable', '2100 Credit card'])
  assert.ok(byRule('wrong-side').every(f => f.lines.length >= 2 && f.lines[0].kind === 'account'))
  const parked = byRule('suspense'); assert.equal(parked.length, 1); assert.equal(parked[0].lines[0].amountCents, 30000); assert.deepEqual(parked[0].setting, { suspenseDays: 7 }); assert.match(parked[0].detail, /\$300\.00/)
  const dups = byRule('duplicate')
  assert.deepEqual(dups.map(f => f.subject.split(':')[0] + ':' + f.lines.map(l => l.label).sort().join('|')).sort(), [
    'bill:Duplicate Co bill D-100|Duplicate Co bill D-101', 'bill:Same Number Ltd bill INV-9|Same Number Ltd bill inv 9', 'payment:Payment to Duplicate Co|Payment to Duplicate Co'].sort())
  assert.ok(!dups.some(f => f.lines.some(l => l.label.startsWith('Weekly Cleaners'))), 'bills one recurring template made are not duplicates')
  const unusual = byRule('unusual-amount')
  assert.deepEqual(unusual.map(f => f.lines[0].label).sort(), ['Mixed Co bill M-900', 'Steady Supplies bill S-10', 'Steady Supplies bill S-410'])
  const flagged = unusual.find(f => f.lines[0].label.endsWith('S-410')); assert.match(flagged.detail, /\$410\.00.*more than 3 times the median \$120\.00 of 6 postings/); assert.equal(flagged.setting.unusualRatio, 3)
  assert.deepEqual(view.flags.filter(f => f.rule === 'clearing' || f.rule === 'payroll'), [])
  // Every flag cites lines and the rule and setting that raised it, and was first flagged by the run.
  assert.ok(view.flags.every(f => f.lines.length && f.detail && view.rules.some(r => r.rule === f.rule) && f.firstFlaggedOn))
  assert.ok((await h.view('activity')).audit.some(a => a.action === 'continuous-check.flag' && a.actor_email === 'pantry:checks'), 'the run records itself as the actor')

  // The run is idempotent: a second run raises nothing new and keeps each flag's id.
  const before = view.flags.map(f => f.id).sort()
  await h.cron(); assert.deepEqual((await flags(h)).map(f => f.id).sort(), before)

  // Dismiss one with a reason; it stays dismissed on the next run, until its lines change.
  const bea = await h.member('bea@example.test', 'bookkeeper'), viewer = await h.member('vic@example.test', 'viewer')
  await h.command('continuous-check.dismiss', { id: parked[0].id, revision: parked[0].revision, reason: 'Waiting on the bank' }, viewer, 403)
  await h.command('continuous-check.dismiss', { id: parked[0].id, revision: parked[0].revision }, bea, 400)
  const dismissed = (await h.command('continuous-check.dismiss', { id: parked[0].id, revision: parked[0].revision, reason: 'Waiting on the bank' }, bea)).flags.find(f => f.id === parked[0].id)
  assert.deepEqual([dismissed.status, dismissed.dismissedBy, dismissed.dismissedReason], ['dismissed', 'bea@example.test', 'Waiting on the bank'])
  await h.cron(); assert.equal((await flags(h)).find(f => f.id === parked[0].id).status, 'dismissed')
  assert.equal((await open(h, 'suspense')).length, 0)
  await w.journal(day(11), 'Second unknown deposit', [{ accountId: suspense.id, debit: '40.00' }, { accountId: acct['3000'], credit: '40.00' }])
  await h.cron()
  const reopened = (await open(h, 'suspense'))[0]; assert.equal(reopened.id, parked[0].id); assert.equal(reopened.lines[0].amountCents, 34000); assert.equal(reopened.dismissedReason, null)

  // Only the owner changes a default; a bad value is refused; a longer limit clears the flag it no longer meets.
  const settings = (await h.view('continuous-checks')).settings
  await h.command('continuous-check.settings', { revision: settings.revision, suspenseDays: 30 }, bea, 403)
  await h.command('continuous-check.settings', { revision: settings.revision, suspenseDays: 0 }, h.owner, 400)
  await h.command('continuous-check.settings', { revision: settings.revision, suspenseDays: 30, unusualMinDifference: '30.00' })
  await h.command('continuous-check.run', {}, bea)
  assert.equal((await open(h, 'suspense')).length, 0)
  assert.ok((await h.view('activity')).audit.some(a => a.action === 'continuous-check.settings' && JSON.parse(a.detail).changes.suspenseDays.to === 30))
  // At the default $100 floor neither of the pennies vendor's odd bills (a $50 and a $2 against a $12 median) was flagged; at $30 the $50 one is and the $2 one, only $10 away, still is not.
  const labels = (await open(h, 'unusual-amount')).map(f => f.lines[0].label)
  assert.ok(labels.includes('Pennies Co bill P-50')); assert.ok(!labels.includes('Pennies Co bill P-tiny'))
})

test('CLOSE-004 twelve months of routine activity for 30 vendors raises no unusual-amount or duplicate flag, and a real outlier among them is still caught', async t => {
  const h = await harness(); t.after(() => h.close())
  const w = await world(h)
  // The default judges the last 60 days; the owner widens it so every one of the twelve months is judged.
  const settings = (await h.view('continuous-checks')).settings
  await h.command('continuous-check.settings', { revision: settings.revision, lookbackDays: 400 })
  let billed = 0, ids = []
  for (let v = 0; v < 30; v++) {
    const vendor = await w.vendor(`Routine Vendor ${String(v).padStart(2, '0')}`), base = 8000 + 1700 * v
    ids.push(vendor)
    for (let m = 0; m < 12; m++, billed++) await w.bill(vendor, `R${v}-${m}`, day(14 + 30 * m + (v % 9)), dollars(Math.round(base * (0.85 + 0.03 * ((v * 7 + m * 5) % 11)))), ['6100', '6200', '6300', '6500'][v % 4])
  }
  assert.equal(billed, 360)
  await h.cron()
  assert.deepEqual((await flags(h)).filter(f => f.rule === 'unusual-amount' || f.rule === 'duplicate'), [])
  assert.equal((await h.view('continuous-checks')).settings.lastRunOn !== null, true)
  await w.bill(ids[7], 'R7-outlier', day(3), '5000.00')
  await h.command('continuous-check.run', {})
  assert.deepEqual((await flags(h)).filter(f => f.rule === 'unusual-amount' || f.rule === 'duplicate').map(f => f.lines[0].label), ['Routine Vendor 07 bill R7-outlier'])
})
