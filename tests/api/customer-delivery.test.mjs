// The real Worker, native owner session, migrations and scheduled handlers.
// Only mail (in harness) and Stripe's HTTP boundary are faked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { at, books, fixture, harness } from './harness.mjs'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const linkIn = message => new URL(message.text.match(/http:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{32}/)[0]).pathname
const recipients = messages => messages.flatMap(m => m.to).sort()
const PRIVATE = 'PRIVATE-CUSTOMER-COLLECTION-NOTE-6842'

test('INVOICE-009 customer payment offerings are enforced at hosted checkout; invoice, recurring and reminder delivery use billing plus cc once per recipient without exposing internal notes', async t => {
  const sessions = new Map(), stripeBodies = []
  const h = await harness({ clock: '2026-10-20T12:00:00Z', outbound: async request => {
    const url = new URL(request.url)
    assert.equal(url.hostname, 'api.stripe.com')
    if (url.pathname === '/v1/account') return Response.json({ id: 'acct_customers', country: 'US', default_currency: 'usd', business_profile: { name: 'Juniper Lane Design' } })
    if (url.pathname === '/v1/checkout/sessions' && request.method === 'POST') {
      const body = new URLSearchParams(await request.text()), id = `cs_customer_${sessions.size + 1}`
      stripeBodies.push(body.toString())
      sessions.set(id, { id, status: 'open', payment_intent: null, body })
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` })
    }
    const id = url.pathname.split('/').at(-1)
    if (request.method === 'GET' && sessions.has(id)) {
      const { body, ...session } = sessions.get(id)
      return Response.json(session)
    }
    assert.fail(`Unexpected Stripe call: ${request.method} ${url.pathname}`)
  } }); t.after(() => h.close())
  const { acct } = await books(h), day = '2026-10-20'
  const settings = async (days, on = true) => {
    const { sending } = await h.view('invoicing')
    await h.command('sending.save', { revision: sending.revision, remindersOn: on, reminderDays: days, timeZone: 'America/New_York' })
  }
  await settings('-1', false)
  const contacts = [
    { name: 'Primary contact', email: 'primary@example.test', phone: '', roles: ['primary'] },
    { name: 'Accounts payable', email: 'BILLING@example.test', phone: '', roles: ['billing'] },
    { name: 'Accounts payable copy', email: 'billing@example.test', phone: '', roles: ['cc'] },
    { name: 'Controller', email: 'controller@example.test', phone: '', roles: ['cc'] },
  ]
  let customer = await h.command('contact.save', { kind: 'customer', name: 'Delivery customer', email: '', contacts, internalNotes: PRIVATE, payMethods: ['card'], termsDays: 30 })
  const update = async values => {
    customer = await h.command('contact.save', { id: customer.id, revision: customer.revision, kind: 'customer', name: customer.name, email: customer.email, termsDays: customer.terms_days, ...values })
  }
  const issue = async customerId => {
    const draft = await h.command('invoice.save-draft', { customerId, issueDate: day, dueDate: day, memo: 'Public invoice memo', lines: [{ description: 'Design services', quantity: '1', rate: '2400.00', accountId: acct['4000'], taxCode: 'exempt' }] })
    const approved = await h.command('invoice.approve', { id: draft.id, revision: draft.revision })
    return h.command('invoice.issue', { id: approved.id })
  }
  const invoice = await issue(customer.id)
  const sent = await h.command('invoice.send', { id: invoice.id })
  assert.deepEqual(sent.deliveries.map(d => d.recipient).sort(), ['billing@example.test', 'controller@example.test'])
  const invoiceMail = () => h.mail.filter(m => m.subject.startsWith(`Invoice ${invoice.number} `))
  assert.deepEqual(recipients(invoiceMail()), ['billing@example.test', 'controller@example.test'])
  const path = linkIn(invoiceMail()[0])
  const page = async () => {
    const response = await h.send(path)
    assert.equal(response.status, 200)
    assert.doesNotMatch(response.value, new RegExp(PRIVATE))
    return response.value
  }
  const pay = async (method, status) => {
    const response = await h.send(path + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: `method=${method}` })
    assert.equal(response.status, status, `${method}: ${response.value}`)
    if (status === 303) assert.match(response.headers.get('location'), /^https:\/\/checkout\.stripe\.com\//)
    return response
  }
  assert.doesNotMatch(await page(), /Pay by|How to pay/, 'card-only customers get no offline instructions when Stripe is unavailable')
  await pay('card', 409)
  await h.command('stripe.connect', { secretKey: 'synthetic-pantry-1002' })
  let html = await page()
  assert.match(html, /Pay by card/); assert.doesNotMatch(html, /Pay by bank account|How to pay/)
  await pay('us_bank_account', 409); await pay('offline', 409)
  assert.equal(sessions.size, 0, 'refused methods never reach Stripe')
  await pay('card', 303)
  assert.equal(sessions.get('cs_customer_1').body.get('allowed_payment_method_types[0]'), 'card')

  await update({ payMethods: ['us_bank_account'] })
  html = await page()
  assert.match(html, /Pay by bank account/); assert.doesNotMatch(html, /Pay by card|How to pay/)
  await pay('card', 409); await pay('us_bank_account', 303)
  assert.equal(sessions.get('cs_customer_2').body.get('allowed_payment_method_types[0]'), 'us_bank_account')
  await update({ payMethods: [] })
  assert.doesNotMatch(await page(), /Pay by|How to pay/)
  await pay('card', 409); await pay('us_bank_account', 409)
  await update({ payMethods: ['offline'] })
  html = await page()
  assert.match(html, /How to pay/); assert.doesNotMatch(html, /Pay by/)
  await pay('card', 409); await pay('us_bank_account', 409); await pay('offline', 409)
  assert.equal(sessions.size, 2)
  await update({ payMethods: null })
  html = await page()
  assert.match(html, /Pay by card/); assert.match(html, /Pay by bank account/); assert.match(html, /How to pay/)
  await h.command('stripe.methods', { card: false, ach: true })
  assert.doesNotMatch(await page(), /Pay by card/)
  await pay('card', 409)
  await h.command('stripe.methods', { card: false, ach: false })
  html = await page()
  assert.doesNotMatch(html, /Pay by/); assert.match(html, /How to pay/)
  await pay('us_bank_account', 409)

  // Default addresses come from the profile; an explicit send remains possible.
  const override = await h.command('invoice.send', { id: invoice.id, to: 'HANDOFF@example.test, handoff@example.test' })
  assert.deepEqual(override.deliveries.map(d => d.recipient), ['handoff@example.test'])
  const fallback = await h.command('contact.save', { kind: 'customer', name: 'Legacy email customer', email: 'legacy@example.test', contacts: [{ name: 'Primary only', email: 'other-primary@example.test', roles: ['primary'] }], internalNotes: PRIVATE })
  const fallbackInvoice = await issue(fallback.id)
  const fallbackSent = await h.command('invoice.send', { id: fallbackInvoice.id })
  assert.deepEqual(fallbackSent.deliveries.map(d => d.recipient), ['legacy@example.test'])

  // Sending templates accept billing contacts even with no customer email.
  let recurring = await h.command('recurring.save', { customerId: customer.id, startDate: day, endDate: day, every: 1, unit: 'month', mode: 'send', termsDays: 30, lines: [{ description: 'Monthly design services', quantity: '1', rate: '2400.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  recurring = await h.command('recurring.approve', { id: recurring.id, revision: recurring.revision })
  await Promise.all([h.cron(), h.cron()])
  let sales = await h.view('sales')
  const generated = at(sales.invoices, i => i.recurring_id === recurring.id)
  const recurringMail = () => h.mail.filter(m => m.subject.startsWith(`Invoice ${generated.number} `))
  assert.deepEqual(recipients(recurringMail()), ['billing@example.test', 'controller@example.test'])
  assert.equal(at(sales.recurring, r => r.id === recurring.id).runs_list[0].status, 'sent')
  await h.cron()
  assert.equal(recurringMail().length, 2, 'overlapping and repeated runs do not resend an occurrence')

  await settings('-1')
  await Promise.all([h.cron(), h.cron()]); await h.cron()
  const reminders = number => h.mail.filter(m => m.subject.startsWith(`Reminder: invoice ${number} `))
  assert.deepEqual(recipients(reminders(invoice.number)), ['billing@example.test', 'controller@example.test'])
  assert.deepEqual(recipients(reminders(fallbackInvoice.number)), ['legacy@example.test'])
  sales = await h.view('sales')
  assert.deepEqual(sales.deliveries.filter(d => d.invoice_id === invoice.id && d.kind === 'reminder').map(d => [d.recipient, d.step]).sort(), [['billing@example.test', -1], ['controller@example.test', -1]])

  // The invoice-wide batch fences new steps and contacts for the whole day.
  await settings('-1,0')
  await h.cron()
  assert.equal(reminders(invoice.number).length, 2)
  await update({ contacts: [...contacts, { name: 'New billing copy', email: 'new-cc@example.test', roles: ['cc'] }] })
  await Promise.all([h.cron(), h.cron()]); await h.cron()
  assert.deepEqual(recipients(reminders(invoice.number)), ['billing@example.test', 'controller@example.test'])
  sales = await h.view('sales')
  const deliveries = sales.deliveries.filter(d => d.invoice_id === invoice.id && d.kind === 'reminder')
  assert.equal(deliveries.length, 2)
  assert.equal(deliveries.some(d => d.recipient === 'new-cc@example.test'), false)
  assert.equal(reminders(fallbackInvoice.number).length, 1)
  assert.equal(h.mail.some(m => m.to.includes('primary@example.test') || m.to.includes('other-primary@example.test')), false)

  const pdf = await h.send(path + '/invoice.pdf')
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/)
  assert.doesNotMatch(pdf.value, new RegExp(PRIVATE))
  assert.match(await page(), /Public invoice memo/)
  for (const mail of h.mail) {
    assert.doesNotMatch(JSON.stringify(mail), new RegExp(PRIVATE))
    for (const attachment of mail.attachments ?? []) assert.doesNotMatch(Buffer.from(attachment.content, 'base64').toString('latin1'), new RegExp(PRIVATE))
  }
  assert.doesNotMatch(stripeBodies.join('\n'), new RegExp(PRIVATE))
})

const LOGO_A = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAUACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwyiiig+aCiiigAooooAKKKKACiiigAooooA//2Q=='
const LOGO_B = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAUACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDEooor4w/SwooooAKKKKACiiigAooooAKKKKAP/9k='

// All presentation changes go through native HTTP commands. Only the mail
// provider is faked; downloaded bytes come from the actual Worker listener.
test('INVOICE-001 branded templates, owner sequence, customer defaults and real-invoice previews retain one issued PDF and hash across email, hosted view, download and later edits', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct } = await books(h)
  const viewer = await h.member('document-viewer@example.test', 'viewer')
  const base = { name: 'Services', layout: 'classic', accentColor: '#174838', textColor: '#202234', address: '18 Cedar Street\nNew York NY 10001', remitTo: 'Juniper Remittance\nPO Box 231', termsDays: 45,
    paymentInstructions: 'Bank transfer: use the invoice number as your reference.', footer: 'Thank you for supporting our studio.', message: 'Services completed under our engagement.', logoBase64: LOGO_A,
    fields: [{ key: 'po_number', label: 'PO number', defaultValue: '' }] }
  let config = await h.view('invoice-documents'), original = config.templates.find(x => x.id === 'standard')
  await h.command('invoice-template.save', { ...base, id: original.id, revision: original.revision }, viewer, 403)
  original = await h.command('invoice-template.save', { ...base, id: original.id, revision: original.revision })
  await h.command('invoice-document-settings.save', { revision: config.settings.revision, nextInvoice: 231, defaultTemplateId: original.id })
  await h.command('invoice-template.save', { ...base, name: 'Bad logo', logoBase64: Buffer.from('<svg></svg>').toString('base64') }, h.owner, 400)
  await h.command('invoice-template.save', { ...base, name: 'Remote logo', logoBase64: 'https://images.example/logo.jpg' }, h.owner, 400)
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Cedar document customer', email: 'cedar-docs@example.test', billingAddress: '40 Studio Lane, Brooklyn NY', internalNotes: PRIVATE })
  const other = await h.command('contact.save', { kind: 'customer', name: 'Willow document customer', email: 'willow-docs@example.test' })
  const body = (customerId, customFields = {}) => ({ customerId, issueDate: '2026-09-01', customFields, lines: [{ description: 'Brand strategy', quantity: '2', rate: '250.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  let draft = await h.command('invoice.save-draft', body(customer.id, { po_number: 'PO-231' }))
  assert.equal(draft.number, 'INV-0231'); assert.equal(draft.due_date, '2026-10-16')
  let preview = await h.view(`invoice-documents/${draft.id}/preview`)
  assert.equal(preview.basis, 'preview'); assert.equal(preview.issuedRevision, null)
  assert.deepEqual(preview.document.facts.find(f => f[0] === 'PO number'), ['PO number', 'PO-231'])
  assert.equal(preview.document.lines[0].quantity, '2')
  await h.send(`/api/pantry/invoice-documents/${draft.id}/preview`, undefined).then(r => assert.equal(r.status, 401))
  await h.send(`/api/pantry/invoice-documents/${draft.id}/pdf`, undefined).then(r => assert.equal(r.status, 401))
  draft = await h.command('invoice.approve', { id: draft.id, revision: draft.revision })
  // Editing a template cannot rewrite the presentation that was approved.
  original = await h.command('invoice-template.save', { ...base, id: original.id, revision: original.revision, message: 'New template message for future invoices.' })
  const issued = await h.command('invoice.issue', { id: draft.id })
  const retained = await h.view(`invoice-documents/${issued.id}/preview`)
  const bytes = Buffer.from(retained.pdfBase64, 'base64'), hash = createHash('sha256').update(bytes).digest('hex')
  assert.equal(retained.basis, 'issued'); assert.equal(retained.issuedRevision, issued.revision)
  assert.equal(retained.sha256, hash); assert.equal(issued.issued_pdf_sha256, hash); assert.equal(issued.issued_document_revision, issued.revision)
  assert.ok(retained.document.notes.includes(base.message)); assert.ok(!retained.document.notes.includes(original.message))
  assert.equal(retained.document.logo.base64, LOGO_A)
  assert.ok(bytes.toString('latin1').includes('/DCTDecode'), 'the logo bytes are embedded in the actual PDF')
  for (const content of [base.address.split('\n')[0], base.remitTo.split('\n')[0], 'PO-231', base.footer, base.paymentInstructions]) assert.ok(bytes.toString('latin1').includes(content))
  const sent = await h.command('invoice.send', { id: issued.id })
  const mail = h.mail.findLast(m => m.to.includes(customer.email)), path = linkIn(mail)
  assert.deepEqual(Buffer.from(mail.attachments[0].content, 'base64'), bytes)
  assert.equal(sent.deliveries[0].attachment_sha256, hash)
  const download = await fetch(h.origin + path + '/invoice.pdf')
  assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
  const hosted = await h.send(path)
  for (const value of ['PO-231', base.footer, 'Issued invoice PDF']) assert.ok(hosted.value.includes(value))
  assert.doesNotMatch(hosted.value, new RegExp(PRIVATE))
  const projects = await h.command('invoice-template.save', { ...base, name: 'Projects', layout: 'banner', accentColor: '#b15837', logoBase64: LOGO_B, message: 'Project milestones.', fields: [{ key: 'project', label: 'Project reference', defaultValue: 'P-81' }] })
  const changed = await h.command('customer.invoice-template', { customerId: customer.id, revision: customer.revision, templateId: projects.id })
  let second = await h.command('invoice.save-draft', body(customer.id))
  assert.equal(second.number, 'INV-0232'); assert.equal(second.document_template_id, projects.id)
  const otherDraft = await h.command('invoice.save-draft', body(other.id, { po_number: 'PO-WILLOW' }))
  assert.equal(otherDraft.document_template_id, original.id)
  const whatIf = await h.view(`invoice-documents/${otherDraft.id}/preview?templateId=${projects.id}`)
  assert.equal(whatIf.document.layout, 'banner'); assert.equal(whatIf.document.logo.base64, LOGO_B)
  assert.deepEqual(whatIf.document.facts.find(f => f[0] === 'Project reference'), ['Project reference', 'P-81'])
  second = await h.command('invoice.approve', { id: second.id, revision: second.revision })
  second = await h.command('invoice.issue', { id: second.id })
  const secondDoc = await h.view(`invoice-documents/${second.id}/preview`)
  assert.equal(secondDoc.document.logo.base64, LOGO_B); assert.equal(secondDoc.document.layout, 'banner')
  assert.ok(secondDoc.document.facts.some(f => f[0] === 'Project reference'))
  assert.ok(!secondDoc.document.facts.some(f => f[0] === 'PO number'))
  assert.notEqual(secondDoc.sha256, hash)
  // Customer, entity, default and payment edits leave the issued file untouched.
  await h.command('contact.save', { id: changed.id, revision: changed.revision, kind: 'customer', name: 'Cedar renamed after issue', billingAddress: 'New address', termsDays: 10 })
  const state = await h.view('state'), entity = state.settings.entity
  await h.command('entity.save', { revision: entity.revision, legalName: 'Juniper new legal name', entityType: entity.entity_type, state: entity.state, fiscalYearStart: entity.fiscal_year_start, taxMethod: entity.tax_method, booksStart: entity.books_start })
  const bank = await h.command('bank-account.save', { name: 'Document payments', institution: 'Bank', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0' })
  await h.command('payment.record', { direction: 'received', contactId: customer.id, date: '2026-09-15', amount: '100.00', bankAccountId: bank.id, allocations: [{ targetId: issued.id, amount: '100.00' }] })
  const after = await h.view(`invoice-documents/${issued.id}/preview`)
  assert.equal(after.pdfBase64, retained.pdfBase64); assert.equal(after.sha256, hash)
  assert.match((await h.send(path)).value, /Current balance: \$400\.00/)
  assert.ok(!(await h.send(path)).value.includes('Cedar renamed after issue'))
  await h.command('invoice.send', { id: issued.id })
  assert.deepEqual(Buffer.from(h.mail.at(-1).attachments[0].content, 'base64'), bytes)
  config = await h.view('invoice-documents')
  await h.command('invoice-document-settings.save', { revision: config.settings.revision, nextInvoice: 231, defaultTemplateId: projects.id }, h.owner, 400)
})


test('INVOICE-001 imported opening invoice PDF previews preserve staged move-in undo and reimport', async t => {
  const h = await harness(); t.after(() => h.close())
  await h.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-09-01' })
  const files = {}
  for (const [key, name] of Object.entries({ accounts: 'account-list.csv', customers: 'customer-contact-list.csv', vendors: 'vendor-contact-list.csv', trialBalance: 'trial-balance.csv', openInvoices: 'open-invoices.csv', unpaidBills: 'unpaid-bills.csv', generalLedger: 'general-ledger.csv' })) files[key] = { name, content: await fixture(`quickbooks-online/${name}`) }
  const pkg = { files, banks: [{ account: 'Operating Checking', institution: 'Chase', last4: '4821', statementBalance: '24813.52' }] }
  const preview = await h.command('move-in.preview', pkg)
  const imported = await h.command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint })
  const invoice = (await h.view('sales')).invoices[0]
  const document = await h.view(`invoice-documents/${invoice.id}/preview`)
  assert.equal(document.basis, 'import')
  assert.match(document.document.lines[0].description, /Opening balance imported/)
  assert.equal(createHash('sha256').update(Buffer.from(document.pdfBase64, 'base64')).digest('hex'), document.sha256)
  const pdf = await h.send(`/api/pantry/invoice-documents/${invoice.id}/pdf`, undefined, { cookie: h.owner })
  assert.equal(pdf.status, 200)
  await h.command('move-in.undo', { jobId: imported.job.id })
  assert.equal((await h.view('sales')).invoices.length, 0)
  await h.view(`invoice-documents/${invoice.id}/preview`, h.owner, 404)
  await h.command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint })
  const restored = (await h.view('sales')).invoices[0]
  const again = await h.view(`invoice-documents/${restored.id}/preview`)
  assert.equal(again.basis, 'import'); assert.equal(again.sha256, document.sha256)
})
