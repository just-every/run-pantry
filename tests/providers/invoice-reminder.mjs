// Held-key delivery proof through the real command and scheduler doors.
// All mail is fenced to the injected controlled mailbox. No secret is retained.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { books, harness } from '../api/harness.mjs'

const to = process.env.TEST_MAIL_TO, from = process.env.MAIL_FROM, key = process.env.MAIL_API_KEY
assert.ok(to && from && key && process.env.QA_INBOX_RECEIPT_TOKEN, 'Required injected inputs are absent')
const marker = `Pantry INVOICE-004 ${randomUUID()}`, since = new Date().toISOString()
console.log(JSON.stringify({subject:marker,startedAt:since}))
let sends = 0
const h = await harness({ bindings: { MAIL_PROVIDER: 'sendgrid', MAIL_API_KEY: key, MAIL_FROM: from }, outbound: async request => {
  assert.equal(new URL(request.url).href, 'https://api.sendgrid.com/v3/mail/send')
  const body = await request.clone().json()
  const recipients = body.personalizations.flatMap(p => [...(p.to ?? []), ...(p.cc ?? []), ...(p.bcc ?? [])]).map(r => r.email)
  assert.deepEqual(recipients, [to], 'Refusing mail outside the controlled inbox')
  assert.ok(sends < 2, 'Refusing more than the invoice and its one reminder')
  sends++
  const response = await fetch(request.url, { method: request.method, headers: {authorization: request.headers.get('authorization'), 'content-type':'application/json'}, body: await request.arrayBuffer(), redirect: 'error', signal: AbortSignal.timeout(15000) })
  const providerMessageId = response.headers.get('x-message-id')
  console.log(JSON.stringify({providerHttpStatus:response.status,providerMessageId}))
  await response.body?.cancel()
  return new Response(null,{status:response.status,headers:providerMessageId ? {'x-message-id':providerMessageId} : {}})
} })
try {
  const { acct } = await books(h)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Pantry controlled delivery proof', email: to })
  let inv = await h.command('invoice.save-draft', { number:'INV-I815-'+randomUUID().slice(0,8), customerId: customer.id, issueDate: today, dueDate: today, lines: [{ description: 'Controlled reminder delivery proof', quantity: '1', rate: '125', accountId: acct['4000'], taxCode: 'exempt' }] })
  inv = await h.command('invoice.approve', { id: inv.id, revision: inv.revision }); inv = await h.command('invoice.issue', { id: inv.id })
  const { sending } = await h.view('invoicing')
  await h.command('sending.save', { revision: sending.revision, remindersOn: true, reminderDays: '0', timeZone: 'America/New_York', reminderSubject: marker, reminderBody: 'Hello {{customer}}, invoice {{invoice}} has {{balance}} open. This is the controlled Pantry reminder proof. {{link}}', replyTo: from.replace(/^.*<([^>]+)>.*$/, '$1') })
  const sent = await h.command('invoice.send', { id: inv.id })
  console.log(JSON.stringify({kind:'invoice',status:sent.deliveries[0].status,providerMessageId:sent.deliveries[0].provider_message_id,detail:sent.deliveries[0].detail}))
  assert.equal(sent.deliveries[0].status, 'accepted', 'Initial invoice was not accepted; do not repeat automatically')
  await Promise.all([h.cron(), h.cron()]); await h.cron()
  const reminders = (await h.view('sales')).deliveries.filter(d => d.invoice_id === inv.id && d.kind === 'reminder')
  assert.equal(reminders.length, 1); assert.equal(reminders[0].status, 'accepted'); assert.ok(reminders[0].provider_message_id)
  console.log(JSON.stringify({ provider: 'sendgrid', status: 'accepted', providerMessageId: reminders[0].provider_message_id, subject: marker, sends }))
  const deadline = Date.now() + 120000
  let receipt
  while (Date.now() < deadline) {
    const url = new URL('https://rer-qa-inbox.runeditrun.workers.dev/receipts')
    for (const [name, value] of Object.entries({ to, since, subject: marker, limit: '10' })) url.searchParams.set(name, value)
    const response = await fetch(url, { headers: { authorization: 'Bearer ' + process.env.QA_INBOX_RECEIPT_TOKEN, 'user-agent': 'Pantry delivery proof' } })
    assert.ok(response.ok, `Inbox HTTP ${response.status}`)
    receipt = (await response.json()).receipts.find(r => r.subject === marker)
    if (receipt) break
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  assert.ok(receipt, 'No delivered inbox receipt; retain the acceptance id and do not resend')
  console.log(JSON.stringify({ provider: 'sendgrid', status: 'delivered', providerMessageId: reminders[0].provider_message_id, inboxReceiptId: receipt.id, receivedAt: receipt.receivedAt, subject: receipt.subject, sends, dailyFence: 'one reminder after overlapping and repeated scheduler runs' }))
} finally { await h.close() }
