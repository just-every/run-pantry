import assert from 'node:assert/strict'
import { books, harness } from './harness.mjs'

export async function remindersJourney(t) {
  const h = await harness({ clock: '2026-10-17T12:00:00Z', sessionClock: '2026-12-01T12:00:00Z' }); t.after(() => h.close())
  const { acct } = await books(h)
  const call = async (op, body, day = '2026-10-17', status = 200) => {
    const r = await h.send('/api/pantry/command/' + op, body, { cookie: h.owner, headers: { 'x-synthetic-pantry-clock': day + 'T12:00:00Z' } })
    assert.equal(r.status, status, op + ': ' + JSON.stringify(r.value)); return r.value
  }
  const bank = await call('bank-account.save', { name: 'Operating', institution: 'Synthetic', accountId: acct['1000'], numberLast4: '1234', routing: '', openingDate: '2026-01-01', openingBalance: '0' })
  const saving = async values => { const { sending } = await h.view('invoicing'); return call('sending.save', { revision: sending.revision, remindersOn: true, reminderDays: '-3,0,7,14,30', timeZone: 'America/New_York', ...values }) }
  await saving({ reminderSubject: '{{business}}: {{invoice}} for {{customer}}', reminderBody: 'Hello {{customer}}, {{balance}} is due {{due_date}}. {{link}} <thank you>' })
  await saving({ reminderBody: '{{unsupported}}' }).then(() => assert.fail('unknown fields accepted'), e => assert.match(e.message, /400/))
  const make = async (name, override, extra = {}) => {
    const customer = await call('contact.save', { kind: 'customer', name, email: 'synthetic-pantry-1@example.test', ...(override !== undefined ? { reminderDays: override } : {}) })
    let inv = await call('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-01', dueDate: '2026-10-20', ...extra, lines: [{ description: 'Design work', quantity: '1', rate: '100', accountId: acct['4000'], taxCode: 'exempt' }] })
    inv = await call('invoice.approve', { id: inv.id, revision: inv.revision }); inv = await call('invoice.issue', { id: inv.id })
    await call('invoice.send', { id: inv.id }); return { customer, inv }
  }
  const paid = await make('Paid on day five'), paused = await make('Paused customer'), open = await make('Open customer'), custom = await make('Custom customer', '2,8'), disabled = await make('No reminders customer', '')
  await call('invoice.reminders', { id: paused.inv.id, paused: true })
  const discounts = await call('account.save', {code:'4950', name:'Sales discounts', type:'income'})
  await call('discount-settings.save', {discountAccountId: discounts.id})
  const short = await make('Late short payment', '0,7', {earlyPayment:{percent:'2',days:10}})
  const discounted = await make('Settled by discount', '0,7', {issueDate:'2026-10-10',earlyPayment:{percent:'2',days:10}})
  for (const item of [short,discounted]) await call('payment.record', {direction:'received',contactId:item.customer.id,date:'2026-10-17',amount:'98',bankAccountId:bank.id,allocations:[{targetId:item.inv.id,amount:'98'}]})
  const credited = await make('Credited to zero')
  let credit = await call('invoice.save-draft', {kind:'credit',creditFor:credited.inv.id,customerId:credited.customer.id,issueDate:'2026-10-17',lines:[{description:'Credit all work',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt'}]})
  credit=await call('invoice.approve',{id:credit.id,revision:credit.revision});await call('invoice.issue',{id:credit.id})
  const count = async id => (await h.view('sales')).deliveries.filter(d => d.invoice_id === id && d.kind === 'reminder')
  const tick = day => h.cron(Date.parse(day + 'T12:00:00Z'))
  await Promise.all([tick('2026-10-17'), tick('2026-10-17')]); await tick('2026-10-17')
  assert.equal((await count(paid.inv.id)).length, 1); assert.equal((await count(open.inv.id)).length, 1)
  assert.equal((await count(paused.inv.id)).length, 0); assert.equal((await count(custom.inv.id)).length, 0)
  const message = h.mail.find(m => m.subject.includes(open.inv.number) && m.subject.includes('Open customer'))
  assert.match(message.text, /Hello Open customer, \$100\.00 is due Oct 20, 2026/)
  assert.match(message.text, /<thank you>/); assert.match(message.html, /&lt;thank you&gt;/); assert.doesNotMatch(message.html, /<thank you>/)
  await tick('2026-10-20'); await tick('2026-10-22')
  assert.equal((await count(custom.inv.id)).length, 1)
  await call('payment.record', { direction: 'received', contactId: paid.customer.id, date: '2026-10-25', amount: '100', bankAccountId: bank.id, allocations: [{ targetId: paid.inv.id, amount: '100' }] }, '2026-10-25')
  for (const day of ['2026-10-27','2026-10-28','2026-11-03','2026-11-19']) await tick(day)
  assert.deepEqual((await count(paid.inv.id)).map(d => d.step).sort((a,b)=>a-b), [-3,0])
  assert.equal((await count(paused.inv.id)).length, 0)
  assert.equal((await count(disabled.inv.id)).length, 0, 'empty customer override disables every business reminder date')
  assert.equal((await count(credited.inv.id)).length, 0)
  assert.equal((await count(discounted.inv.id)).length, 0)
  assert.deepEqual((await count(short.inv.id)).map(d=>d.step).sort((a,b)=>a-b), [0,7])
  const balances=(await h.view('sales')).invoices
  assert.equal(balances.find(i=>i.id===short.inv.id).open_cents,200)
  assert.equal(balances.find(i=>i.id===discounted.inv.id).open_cents,0)
  assert.deepEqual((await count(open.inv.id)).map(d => d.step).sort((a,b)=>a-b), [-3,0,7,14,30])
  assert.deepEqual((await count(custom.inv.id)).map(d => d.step).sort((a,b)=>a-b), [2,8])
  assert.ok((await count(open.inv.id)).every(d => d.status === 'accepted' && d.provider_message_id))
  // The durable batch also fences a schedule edit and new billing recipient.
  let current = (await h.view('state')).contacts.find(c => c.id === open.customer.id)
  await call('contact.save', { id: current.id, revision: current.revision, kind: 'customer', name: current.name, email: current.email, reminderDays: '31', contacts: [{ name: 'New billing', email: 'synthetic-pantry-2@example.test', roles: ['billing'] }] }, '2026-11-19')
  await tick('2026-11-19'); assert.equal((await count(open.inv.id)).length, 5)
  await tick('2026-11-20'); assert.equal((await count(open.inv.id)).length, 6)
  // A disputed case remains stopped even if the generic pause is cleared.
  await call('collections.prepare', {}, '2026-11-20')
  const cases = (await h.view('collections')).cases, row = cases.find(c => c.invoice_id === open.inv.id)
  assert.ok(row)
  await call('collections.hold', { id: open.inv.id, revision: row.revision, status: 'disputed', note: 'Customer disputes the work' }, '2026-11-20')
  await call('invoice.reminders', { id: open.inv.id, paused: false }, '2026-11-20')
  current = (await h.view('state')).contacts.find(c => c.id === open.customer.id)
  await call('contact.save', { id: current.id, revision: current.revision, kind: 'customer', name: current.name, email: current.email, reminderDays: '32' }, '2026-11-20')
  await tick('2026-11-21'); assert.equal((await count(open.inv.id)).length, 6)
  const boundary=await make('Business midnight customer','33,34')
  await h.cron(Date.parse('2026-11-23T04:30:00Z'))
  await h.cron(Date.parse('2026-11-23T05:30:00Z'))
  assert.deepEqual((await count(boundary.inv.id)).map(d=>d.step).sort((a,b)=>a-b),[33,34],'Distinct business days can share a UTC date')
}
