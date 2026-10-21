// Backup and restore exactly as /docs/backup tells a person to, through `rer` on fresh
// clones of the committed checkout: export, restore into a fresh install (import before
// setup), start over in the same folder, and a restore refused because books are there.
// Set PANTRY_RER_HOME to run the rer processes under another HOME.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'
import { fileRecords } from '@runeditrun/rer/modules/portability/files'
import { books } from '../app/books.mjs'

const source = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const entry = join(source, 'node_modules/@runeditrun/rer/global/rer.mjs')
const env = { ...process.env, ...(process.env.PANTRY_RER_HOME ? { HOME: process.env.PANTRY_RER_HOME } : {}), WRANGLER_SEND_METRICS: 'false' }
const roots = [], running = new Set()

async function fresh() {
  const root = await mkdtemp(join(tmpdir(), 'pantry-restore-'))
  roots.push(root)
  await promisify(execFile)('git', ['clone', '--no-hardlinks', '--quiet', source, root])
  return root
}

async function freePort() {
  const s = createServer()
  await new Promise(r => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise(r => s.close(r))
  return port
}

/** One rer command; returns its exit code and output. */
async function rer(root, args) {
  const child = spawn(process.execPath, [entry, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', c => { log += c })
  const code = await new Promise((ok, fail) => { child.once('error', fail); child.once('close', ok) })
  return { code, log }
}
const ok = async (root, args) => { const r = await rer(root, args); assert.equal(r.code, 0, `rer ${args[0]}:\n${r.log.slice(-4000)}`); return r.log }

/** `rer dev` in the foreground until it prints its sign-in link. */
async function dev(root, port) {
  const child = spawn(process.execPath, [entry, 'dev', '--port', String(port), '--foreground'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', c => { output += c })
  const deadline = Date.now() + 10 * 60 * 1000
  while (!/RER_OPEN \S+/.test(output) && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev exited: ${output.slice(-4000)}`)
    await new Promise(r => setTimeout(r, 250))
  }
  const link = output.match(/RER_OPEN (\S+)/)?.[1]
  assert.ok(link, 'dev printed its sign-in link')
  const server = { origin: new URL(link).origin, link, async stop() {
    running.delete(server)
    if (child.exitCode !== null) return
    const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid='])
    const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number)), owned = new Set([child.pid])
    for (let changed = true; changed;) { changed = false; for (const [pid, parent] of rows) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); changed = true } }
    for (const pid of [...owned].reverse()) try { process.kill(pid, 'SIGTERM') } catch (e) { if (e.code !== 'ESRCH') throw e }
    if (child.exitCode === null) await new Promise(r => child.once('exit', r))
  } }
  running.add(server)
  return server
}

/** Open the sign-in link, finish first-run setup if it is asked for, and return the signed-in context. */
async function signIn(browser, server) {
  const context = await browser.newContext()
  const page = await context.newPage()
  // The link's page keeps this checkout's dev key as a cookie, then opens the app.
  await page.goto(server.link)
  await page.waitForURL(u => new URL(u).pathname !== '/__dev/key')
  await page.goto(`${server.origin}/app`)
  if (new URL(page.url()).pathname === '/setup') {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await page.waitForURL(u => new URL(u).pathname !== '/setup')
  }
  await page.close()
  return context
}

/** The books as a person sees them, and one document's bytes. */
async function snapshot(context, origin, docName) {
  const get = async path => (await context.request.get(`${origin}/api/pantry/${path}`)).json()
  const state = await get('state'), sales = await get('sales'), documents = (await get('documents')).documents
  const reports = (await get('custom-reports')).reports, packages = (await get('management-packages')).packages
  const definitions = rows => rows.map(({ id, name, definition, shared_roles, created_by }) => ({ id, name, definition, shared_roles, created_by })).sort((a, b) => a.id.localeCompare(b.id))
  const doc = documents.find(d => d.name === docName)
  return {
    view: {
      business: state.settings.entity.legal_name, accounts: state.accounts.map(a => [a.code, a.name, a.subtype]), contacts: state.contacts.map(c => c.name).sort(),
      invoices: sales.invoices.map(i => [i.number, i.total_cents, i.open_cents]), bills: sales.bills.map(b => [b.reference, b.open_cents, b.lifecycle, b.scheduled_date, b.scheduled_note]),
      invoiceTemplates: await get('invoice-documents'),
      invoiceDocuments: await Promise.all(sales.invoices.filter(i => i.status === 'issued').map(i => get(`invoice-documents/${i.id}/preview`))),
      recurringBills: sales.recurringBills,
      trialBalance: (await get('reports/trial-balance?to=2026-09-30')).rows.map(r => [r.code, r.net]),
      pl: (await get('reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=cash')).netIncome,
      lines: (await get('bank/lines')).lines.map(l => [l.posted_date, l.description, l.amount_cents]).sort(),
      documents: documents.map(d => [d.name, d.sha256]).sort(),
      customReports: definitions(reports), managementPackages: definitions(packages),
      customReportValues: await Promise.all(reports.map(async r => (await get(`custom-reports/${r.id}/render`)).report)),
      audit: (await get('activity')).audit.map(({ approval, ...row }) => row).sort((a, b) => a.id.localeCompare(b.id)),
      approvals: (await get('activity')).approvals.sort((a, b) => a.id.localeCompare(b.id)),
    },
    bytes: doc ? Buffer.from(await (await context.request.get(`${origin}/api/pantry/documents/${doc.id}`)).body()) : null,
  }
}

test('BILL-001/INVOICE-001/AUDIT-001/REPORT-006/ERASURE-001 books and receipts restore, occupied books stay protected, and known erasures fence older archives', async t => {
  t.after(async () => { for (const server of [...running]) await server.stop(); for (const root of roots) await rm(root, { recursive: true, force: true }) })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())

  // The first install, with books and a document.
  const first = await fresh(), port = await freePort()
  await ok(first, ['setup', '--owner-email', 'owner@dev.localhost', '--port', String(port), '--non-interactive'])
  let server = await dev(first, port), context = await signIn(browser, server)
  await books(context.request, server.origin)
  const pdf = Buffer.from('%PDF-1.4 Acme invoice A-778 for $1,500.00\n')
  const bill = (await (await context.request.get(`${server.origin}/api/pantry/sales`)).json()).bills.find(b => b.reference === 'A-778')
  assert.equal((await context.request.post(`${server.origin}/api/pantry/command/document.upload`, { headers: { origin: server.origin }, data: { name: 'acme-a-778.pdf', mediaType: 'application/pdf', base64: pdf.toString('base64'), linkedKind: 'bill', linkedId: bill.id } })).status(), 200)
  const command = async (op, data) => { const r = await context.request.post(`${server.origin}/api/pantry/command/${op}`, { headers: { origin: server.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  const saved = await command('custom-report.save', { sharedRoles: ['accountant'], definition: { name: 'Restored management margin', source: 'profit-and-loss', from: '2026-09-01', to: '2026-09-30', basis: 'accrual', columns: ['name', 'amount'], layout: [
    { id: 'revenue', kind: 'section', label: 'Revenue', accountTypes: ['income'] }, { id: 'cost', kind: 'section', label: 'Costs', accountTypes: ['expense'] },
    { id: 'gross', kind: 'formula', label: 'Gross profit', expression: 'row("revenue") - row("cost")', unit: 'money' },
  ], notes: ['Definitions travel with the books.'] } })
  await command('management-package.save', { name: 'Restored management package', cover: 'Restored cover', commentary: ['Preserve the accountant review.'], reportIds: [saved.id], sharedRoles: ['accountant'] })
  // Retained documents, customer defaults and recurring drafts must travel with the books.
  const invoiceState = await (await context.request.get(`${server.origin}/api/pantry/state`)).json()
  const income = invoiceState.accounts.find(a => a.code === '4000').id, rent = invoiceState.accounts.find(a => a.code === '6100').id
  const customer = invoiceState.contacts.find(c => c.kind === 'customer'), vendor = invoiceState.contacts.find(c => c.kind === 'vendor')
  const branded = await command('invoice-template.save', { name: 'Archived services', layout: 'banner', accentColor: '#174838', textColor: '#202234', termsDays: 45, address: '18 Cedar Street', remitTo: 'Juniper Remittance', paymentInstructions: 'Use invoice reference', footer: 'Thank you', message: 'Archived engagement', fields: [{ key: 'po', label: 'PO number', defaultValue: 'PO-RESTORE' }] })
  const settings = (await (await context.request.get(`${server.origin}/api/pantry/invoice-documents`)).json()).settings
  await command('invoice-document-settings.save', { revision: settings.revision, nextInvoice: 231, defaultTemplateId: branded.id })
  await command('customer.invoice-template', { customerId: customer.id, revision: customer.revision, templateId: branded.id })
  const brandedDraft = await command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-09-20', customFields: { po: 'PO-RESTORE' }, lines: [{ description: 'Retained engagement', quantity: '1', rate: '100.00', accountId: income, taxCode: 'exempt' }] })
  await command('invoice.approve', { id: brandedDraft.id, revision: brandedDraft.revision }); await command('invoice.issue', { id: brandedDraft.id })
  await command('bill.schedule', { id: bill.id, revision: bill.revision, date: '2026-09-24', note: 'Bank transfer outside Pantry' })
  await command('recurring-bill.save', { name: 'Archived rent', vendorId: vendor.id, startDate: '2026-06-30', endDate: '2026-08-30', every: 1, unit: 'month', termsDays: 15, lines: [{ description: 'Monthly rent', amount: '1200.00', accountId: rent }] })
  await command('recurring-bill.generate', { through: '2026-09-30' })
  const lead = await command('contact.save', { kind: 'customer', name: 'Synthetic Pantry Lead', email: 'synthetic-pantry-lead@example.test', internalNotes: 'Synthetic lead private note' })
  const latestCustomer = (await (await context.request.get(`${server.origin}/api/pantry/state`)).json()).contacts.find(c => c.id === customer.id)
  await command('contact.save', { id: customer.id, revision: latestCustomer.revision, kind: 'customer', email: 'synthetic-pantry-customer@example.test', phone: 'synthetic-pantry-phone', billingAddress: 'Synthetic Pantry Address', internalNotes: 'Synthetic Pantry private note', contacts: [{ name: 'Synthetic Pantry Billing', email: 'synthetic-pantry-billing@example.test', roles: ['billing'] }] })
  // Erasure refuses unresolved balances. Settle through the same payment door
  // a person uses before capturing the pre-erasure backup and book totals.
  const salesBeforeBackup = await (await context.request.get(`${server.origin}/api/pantry/sales`)).json()
  for (const invoice of salesBeforeBackup.invoices.filter(i => i.customer_id === customer.id && i.kind === 'invoice' && i.open_cents > 0)) {
    const amount = (invoice.open_cents / 100).toFixed(2)
    await command('payment.record', { direction: 'received', contactId: customer.id, date: '2026-09-30', amount, bankAccountId: invoiceState.bankAccounts[0].id, allocations: [{ targetId: invoice.id, amount }] })
  }
  const before = await snapshot(context, server.origin, 'acme-a-778.pdf')
  assert.deepEqual(before.bytes, pdf)
  await context.close(); await server.stop()
  await ok(first, ['export', '--output', 'exports/pantry-books.rer'])

  // Restore into a fresh install, as the docs say: import first, then set up the owner.
  const second = await fresh(), port2 = await freePort()
  await mkdir(join(second, 'exports'), { recursive: true })
  await copyFile(join(first, 'exports/pantry-books.rer'), join(second, 'exports/pantry-books.rer'))
  const unverified = await ok(second, ['import', '--input', 'exports/pantry-books.rer', '--yes'])
  assert.match(unverified, /ask the source owner/i)
  assert.match(unverified, /erasure history unverified/i)
  await ok(second, ['setup', '--owner-email', 'you@dev.localhost', '--port', String(port2), '--non-interactive'])
  server = await dev(second, port2); context = await signIn(browser, server)
  const restored = await snapshot(context, server.origin, 'acme-a-778.pdf')
  assert.deepEqual(restored.view, before.view, 'the fresh install holds the same books')
  assert.deepEqual(restored.bytes, pdf, 'the document comes back byte for byte')
  await context.close(); await server.stop()

  // A restore into a folder that holds books changes nothing and says what to do instead.
  const refused = await rer(second, ['import', '--input', 'exports/pantry-books.rer', '--yes'])
  assert.equal(refused.code, 4)
  assert.match(refused.log, /target_not_empty\): this folder already holds Pantry books/)
  assert.match(refused.log, /rer reset --yes; rer import --input/)

  // Start over in the first folder, exactly as the docs list it.
  await ok(first, ['reset', '--yes'])
  await ok(first, ['import', '--input', 'exports/pantry-books.rer', '--yes'])
  await ok(first, ['setup', '--owner-email', 'owner@dev.localhost', '--port', String(port), '--non-interactive'])
  server = await dev(first, port); context = await signIn(browser, server)
  const again = await snapshot(context, server.origin, 'acme-a-778.pdf')
  assert.deepEqual(again.view, before.view, 'starting over brings the same books back')
  assert.deepEqual(again.bytes, pdf)

  // The same public erase operation removes a lead and redacts a posted
  // customer. Their source-bound fence and value-free receipts must travel.
  const receipts = []
  for (const id of [lead.id, customer.id]) {
    const preview = await command('erasure.preview', { kind: 'contact', id })
    receipts.push(await command('erasure.execute', { kind: 'contact', id, fingerprint: preview.fingerprint, requester: 'Synthetic Pantry request', channel: 'email', reason: 'Synthetic Pantry privacy request', confirm: 'ERASE' }))
  }
  const erasedState = (await (await context.request.get(`${server.origin}/api/pantry/state`)).json()).contacts
  assert.ok(!erasedState.some(c => c.id === lead.id), 'the transaction-free lead is gone')
  const retainedCustomer = erasedState.find(c => c.id === customer.id)
  assert.equal(retainedCustomer.name, customer.name, 'posted books retain the legal name')
  const personal = JSON.stringify([retainedCustomer.email, retainedCustomer.phone, retainedCustomer.billing_address, retainedCustomer.internal_notes, retainedCustomer.contacts_json])
  for (const value of ['synthetic-pantry-customer@example.test', 'synthetic-pantry-phone', 'Synthetic Pantry Address', 'Synthetic Pantry private note', 'synthetic-pantry-billing@example.test']) assert.ok(!personal.includes(value), 'the retained customer no longer exposes a private field')
  const afterErasure = await snapshot(context, server.origin, 'acme-a-778.pdf')
  for (const field of ['invoices', 'bills', 'trialBalance', 'pl']) assert.deepEqual(afterErasure.view[field], before.view[field], `erasure preserves ${field}`)
  assert.deepEqual(afterErasure.bytes, pdf, 'supporting posted evidence is retained')
  await context.close(); await server.stop()
  await ok(first, ['export', '--output', 'exports/pantry-after-erasure.rer'])
  const journal = []
  for await (const record of fileRecords(join(first, 'exports/pantry-after-erasure.rer'))) if (record.kind === 'part') {
    for (const item of record.items) if (item.kind === 'row' && item.table === 'pt_erasure_journal') journal.push(item.row)
  }
  for (const receipt of receipts) assert.ok(journal.some(row => row.id === receipt.id), 'the post-erasure archive carries each receipt')

  const sameStore = await rer(first, ['import', '--input', 'exports/pantry-books.rer', '--yes'])
  assert.equal(sameStore.code, 4)
  assert.match(sameStore.log, /restore refused \((erasure_epoch|erased_row)\)/i)
  assert.match(sameStore.log, /erasure journal/i)
  for (const receipt of receipts) assert.ok(sameStore.log.includes(receipt.id), 'same-store refusal names the known erasure')

  // A reset has no local erasure knowledge. The owner's later source archive
  // supplies it, so even this empty destination refuses the pre-erasure backup.
  await ok(second, ['reset', '--yes'])
  await copyFile(join(first, 'exports/pantry-after-erasure.rer'), join(second, 'exports/pantry-after-erasure.rer'))
  const oldArchive = await rer(second, ['import', '--input', 'exports/pantry-books.rer', '--journal', 'exports/pantry-after-erasure.rer', '--yes'])
  assert.equal(oldArchive.code, 4)
  assert.match(oldArchive.log, /restore refused \((erasure_epoch|erased_row)\)/i)
  for (const receipt of receipts) assert.ok(oldArchive.log.includes(receipt.id), 'the refusal names known erasure receipts')
  await ok(second, ['import', '--input', 'exports/pantry-after-erasure.rer', '--journal', 'exports/pantry-after-erasure.rer', '--yes'])
  await ok(second, ['setup', '--owner-email', 'you@dev.localhost', '--port', String(port2), '--non-interactive'])
  server = await dev(second, port2); context = await signIn(browser, server)
  const anonymous = await snapshot(context, server.origin, 'acme-a-778.pdf')
  assert.deepEqual(anonymous.view, afterErasure.view, 'the post-erasure books and receipts restore without resurrecting the lead')
  assert.deepEqual(anonymous.bytes, pdf)
  const restoredContacts = (await (await context.request.get(`${server.origin}/api/pantry/state`)).json()).contacts
  assert.deepEqual(restoredContacts.find(c => c.id === customer.id), retainedCustomer, 'retained personal fields stay redacted after restore')
  await context.close(); await server.stop()
})
