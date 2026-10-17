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
  const server = { origin: new URL(link).origin, link, async stop() { running.delete(server); await rer(root, ['dev', '--stop']); if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) } } }
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
  const doc = documents.find(d => d.name === docName)
  return {
    view: {
      business: state.settings.entity.legal_name, accounts: state.accounts.map(a => [a.code, a.name, a.subtype]), contacts: state.contacts.map(c => c.name).sort(),
      invoices: sales.invoices.map(i => [i.number, i.total_cents, i.open_cents]), bills: sales.bills.map(b => [b.reference, b.open_cents]),
      trialBalance: (await get('reports/trial-balance?to=2026-09-30')).rows.map(r => [r.code, r.net]),
      pl: (await get('reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=cash')).netIncome,
      lines: (await get('bank/lines')).lines.map(l => [l.posted_date, l.description, l.amount_cents]).sort(),
      documents: documents.map(d => [d.name, d.sha256]).sort(),
    },
    bytes: doc ? Buffer.from(await (await context.request.get(`${origin}/api/pantry/documents/${doc.id}`)).body()) : null,
  }
}

test('the books come back from an export into a fresh install and after starting over, and a restore over books is refused with the next step', async t => {
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
  const before = await snapshot(context, server.origin, 'acme-a-778.pdf')
  assert.deepEqual(before.bytes, pdf)
  await context.close(); await server.stop()
  await ok(first, ['export', '--output', 'exports/pantry-books.rer'])

  // Restore into a fresh install, as the docs say: import first, then set up the owner.
  const second = await fresh(), port2 = await freePort()
  await mkdir(join(second, 'exports'), { recursive: true })
  await copyFile(join(first, 'exports/pantry-books.rer'), join(second, 'exports/pantry-books.rer'))
  await ok(second, ['import', '--input', 'exports/pantry-books.rer', '--yes'])
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
  await context.close(); await server.stop()
})
