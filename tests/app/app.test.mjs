// The built app in a browser, on the emitted Worker and its own migrated D1: the owner
// signs in with the setup token, the books are made through the public API, and then a
// person clicks through what a stranger did. Run after `pnpm run build`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { books } from './books.mjs'

const TOKEN = 'synthetic-app-test-setup-token-0123456789abcdef'
const wrangler = ['node_modules/wrangler/bin/wrangler.js']
const quiet = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }

async function freePort() {
  const s = createServer()
  await new Promise(r => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise(r => s.close(r))
  return port
}

/** The emitted Worker on 127.0.0.1 with a local owner; resolves once /health answers. */
async function worker() {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`, persist = await mkdtemp(join(tmpdir(), 'pantry-app-'))
  execFileSync(process.execPath, [...wrangler, 'd1', 'migrations', 'apply', 'foundation', '--local', '--persist-to', persist, '--config', 'dist/server/wrangler.json'], { stdio: 'pipe', env: quiet })
  const vars = { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'app-test-session-secret-0123456789abcdef', SETUP_TOKEN: TOKEN, MAIL_PROVIDER: 'development', MAIL_FROM: 'Pantry <pantry@example.test>' }
  const child = spawn(process.execPath, [...wrangler, 'dev', '--inspector-port', '0', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--port', String(port), '--config', 'dist/server/wrangler.json', ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { stdio: ['ignore', 'pipe', 'pipe'], env: quiet })
  let output = ''
  child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(output)
    try { if ((await fetch(`${origin}/health`)).ok) break } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  return { origin, async close() { child.kill('SIGTERM'); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); await rm(persist, { recursive: true, force: true }) } }
}

test('every report opens by clicking it, at 1440 and 390, and a payment made from its bank line pays its bill', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const boot = await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  assert.equal(boot.status(), 303, await boot.text())
  const setup = await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  assert.equal(setup.status(), 303)
  await books(owner.request, app.origin)
  const signedIn = await owner.storageState()

  const reports = ['General ledger', 'Profit and loss', 'Balance sheet', 'Receivables aging', 'Payables aging', 'Sales tax by state', '1099 contractors', 'Trial balance']
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width > 500 ? 900 : 844 } })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/reports?from=2026-09-01&to=2026-09-30`)
    await page.getByRole('heading', { name: 'Trial balance' }).waitFor()
    for (const report of reports) {
      if (width > 500) await page.getByRole('tab', { name: report }).click()
      else await page.getByLabel('Report', { exact: true }).selectOption(report)
      await page.getByRole('heading', { name: new RegExp(`^${report}`) }).waitFor()
      assert.equal(await page.getByText('Something went wrong').count(), 0, `${report} at ${width}`)
    }
    assert.deepEqual(errors, [], `no page errors at ${width}`)
    await context.close()
  }

  // The stranger's way: the bank line, a vendor payment to Acme, approve. It pays A-778 without a second step.
  const page = await owner.newPage()
  await page.goto(`${app.origin}/app/bank`)
  await page.getByRole('row', { name: /ACH DEBIT ACME CONTRACTORS/ }).getByRole('button', { name: 'File it' }).click()
  await page.getByRole('button', { name: '+ Vendor payment' }).click()
  await page.getByLabel('Vendor', { exact: true }).selectOption({ label: 'Acme Contractors' })
  await assert.doesNotReject(page.getByLabel(/A-778/).and(page.locator('[value="1500.00"]')).waitFor(), 'the bill it names is filled in')
  await page.getByRole('button', { name: 'Approve match' }).click()
  await page.getByText('Filed', { exact: true }).first().waitFor()
  const sales = await (await owner.request.get(`${app.origin}/api/pantry/sales`)).json()
  assert.equal(sales.bills.find(b => b.reference === 'A-778').open_cents, 0)
  const pl = await (await owner.request.get(`${app.origin}/api/pantry/reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=cash`)).json()
  assert.equal(pl.expenses.find(e => e.code === '6000').amount, 150000, 'the cash basis counts the contractor cost in September')

  // Put Pantry online never offers the placeholder owner address: it asks for the owner's own email, then fills the deploy lines with it.
  await page.goto(`${app.origin}/app/settings`)
  const online = page.locator('#put-online')
  await online.getByText('Set up hosting').click()
  await online.getByLabel('Your own email').waitFor()
  assert.equal(await online.locator('pre').count(), 0, 'no deploy lines with the placeholder owner')
  await online.getByLabel('Your own email').fill('books@run-pantry.com')
  await online.getByText('OWNER_EMAIL=books@run-pantry.com').waitFor()
})
