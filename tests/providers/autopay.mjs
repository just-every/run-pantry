// Run through the owner's credential injector after the production app is built.
// Setup, mandates, methods, charges and hosted collection use real Stripe.
// Unrelated account-wide event discovery is isolated at its network edge;
// the API journey proves comparison independently. Local mail is suppressed.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { providerWorker } from '../app/provider-worker.mjs'
import { TOKEN } from '../app/worker.mjs'
import { declinedCard } from './autopay-card.mjs'

const key = process.env.STRIPE_US_TEST_SECRET_KEY
assert.ok(key && key.includes('_test_'), 'Injected Stripe test access is required')
const proof = process.env.PANTRY_PROOF_DIR
assert.ok(proof, 'PANTRY_PROOF_DIR is required for private stage evidence')
await mkdir(proof, { recursive: true, mode: 0o700 })
const scenario = process.env.PANTRY_AUTOPAY_SCENARIO ?? 'all'
assert.ok(['all', 'card'].includes(scenario), 'Choose the full journey or its independent card scenario')
const receipt = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), ranAt: new Date().toISOString(), testMode: true, scenario, isolatedEdges: ['account-wide event listing'], stage: 'starting', status: 'running' }
let app, browser, page
const retain = async () => writeFile(join(proof, 'autopay-provider.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
const stage = async (name, screen = page, capture = true) => {
  receipt.stage = name
  await retain()
  if (screen && capture) {
    try { await screen.screenshot({ path: join(proof, `autopay-provider-${name}.png`), fullPage: new URL(screen.url()).origin === app?.origin, animations: 'disabled', timeout: 5000 }) }
    catch { receipt.captureFailures ??= []; receipt.captureFailures.push(name); await retain() }
  }
}
const stripe = async (path, params) => {
  const response = await fetch(`https://api.stripe.com/v1${path}`, { method: params ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2026-09-30.endive' }, ...(params ? { body: new URLSearchParams(params) } : {}), signal: AbortSignal.timeout(20000) })
  assert.equal(response.status, 200, `Stripe HTTP ${response.status}`)
  return response.json()
}
async function hostedFrames() {
  const frames = page.frames()
  const bank = frames.find(frame => frame.url().includes('/linked-accounts-inner-'))
  if (bank && await (await bank.frameElement()).isVisible().catch(() => false)) {
    return frames.filter(frame => {
      for (let current = frame; current; current = current.parentFrame()) if (current === bank) return true
      return false
    })
  }
  return frames
}
async function findInFrames(build, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    for (const frame of await hostedFrames()) {
      const locator = build(frame).first()
      if (await locator.isVisible().catch(() => false)) return locator
    }
    await page.waitForTimeout(250)
  }
  throw new Error('The expected hosted Stripe control was not available')
}
async function visible(build) {
  for (const frame of await hostedFrames()) { const locator = build(frame).first(); if (await locator.isVisible().catch(() => false)) return locator }
  return null
}
try {
  await stage('starting')
  app = await providerWorker({ clock: true, bindings: {}, outbound: async request => {
    assert.equal(new URL(request.url).hostname, 'api.stripe.com', 'Only the connected real Stripe account may receive upstream traffic')
    if (new URL(request.url).pathname === '/v1/events') return Response.json({ data: [], has_more: false })
    if (request.method === 'POST' && new URL(request.url).pathname === '/v1/payment_intents') receipt.paymentSubmissions = (receipt.paymentSubmissions ?? 0) + 1
    const response = await fetch(request.url, { method: request.method, headers: Object.fromEntries(['authorization', 'content-type', 'stripe-version', 'idempotency-key'].filter(n => request.headers.has(n)).map(n => [n, request.headers.get(n)])), ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.text() } : {}),signal:AbortSignal.timeout(20000) })
    if(response.status>=400){const failure=await response.clone().json().catch(()=>({}));const parameter=failure.error?.param;receipt.providerErrors??=[];receipt.providerErrors.push({http:response.status,code:failure.error?.code??null,confirmedDecline:response.status===402&&failure.error?.payment_intent?.status==='requires_payment_method',parameter:typeof parameter==='string'&&/^[a-zA-Z0-9_\[\].]+$/.test(parameter)?parameter:null});await retain()}
    return new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries([...response.headers].filter(([name])=>!['content-encoding','content-length','transfer-encoding'].includes(name))) })
  } })
  browser = await chromium.launch({ headless: true, executablePath: process.env.PANTRY_CHROMIUM_PATH, args: ['--use-mock-keychain', '--password-store=basic'] })
  const clock = '2026-10-26T16:00:00Z', day = '2026-10-26', headers = { 'x-synthetic-pantry-clock': clock, 'cf-connecting-ip': '192.0.2.10' }
  const owner = await browser.newContext({ extraHTTPHeaders: headers })
  assert.equal((await owner.request.post(app.origin + '/auth/bootstrap', { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Synthetic Pantry' }, maxRedirects: 0 })).status(), 303)
  await owner.request.post(app.origin + '/setup', { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const command = async (op, data) => { const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, `Pantry command refused: ${op}`); return r.json() }
  const view = async path => { const r = await owner.request.get(`${app.origin}/api/pantry/${path}`); assert.equal(r.status(), 200, 'Pantry read refused'); return r.json() }
  await command('entity.save', { legalName: 'Synthetic Pantry test business', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: day, policies: '' })
  await command('chart.start', {}); await stage('connecting-stripe'); await command('stripe.connect', { secretKey: key }); await stage('stripe-connected')
  const acct = (await view('state')).accounts.find(a => a.code === '4000').id
  if (scenario === 'card') {
    await declinedCard({ app, browser, headers, command, view, acct, day, stripe, receipt, retain, stage })
    receipt.status = 'completed'; receipt.stage = 'retained-provider-outcome'
    await retain(); console.log(JSON.stringify(receipt))
  } else {
  const customer = await command('contact.save', { kind: 'customer', name: 'Synthetic Pantry', email: 'synthetic-pantry@example.test', billingAddress: '12 Cedar Street, New York NY 10001', termsDays: 1 })
  let recurring = await command('recurring.save', { customerId: customer.id, startDate: day, every: 1, unit: 'month', termsDays: 1, mode: 'send', lines: [{ description: 'Synthetic recurring test service', quantity: '1', rate: '1', accountId: acct, taxCode: 'exempt' }] })
  recurring = await command('recurring.approve', { id: recurring.id, revision: recurring.revision })
  await app.cron(Date.parse(clock))
  await stage('recurring-invoice-issued')
  const invoice = (await view('sales')).invoices.find(i => i.recurring_id === recurring.id)
  assert.ok(invoice?.link_token)
  await command('autopay.policy', { customerId: customer.id, recurringId: recurring.id, enabled: true, consent: true, purpose: 'Synthetic recurring test service at the billing address', noticeRecipients: [{ recipient: customer.email, timeZone: 'America/New_York' }] })
  const payer = await browser.newContext({ extraHTTPHeaders: headers, viewport: { width: 1280, height: 1000 } })
  page = await payer.newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${app.origin}/i/${invoice.link_token}`)
  await page.getByText('Save a method for recurring invoices', { exact: true }).click()
  await page.getByLabel('Payment method', { exact: false }).selectOption('us_bank_account')
  await page.getByLabel('I authorize these recurring charges and agree to the authorization above.', { exact: true }).check()
  await stage('pantry-authorization')
  await page.getByRole('button', { name: 'Continue to Stripe to save method', exact: true }).click()
  await page.waitForURL(url => url.hostname === 'checkout.stripe.com')
  await stage('stripe-checkout')
  const setups = await app.db.prepare('SELECT session_id FROM pt_autopay_setups WHERE customer_id=? ORDER BY accepted_at DESC LIMIT 1').bind(customer.id).first()
  assert.ok(setups?.session_id)
  receipt.checkoutSession = setups.session_id
  await retain()
  // Use Stripe’s own sandbox bank Autofill control on its hosted form.
  for (let step = 0; step < 30; step++) {
    if (new URL(page.url()).origin === app.origin) break
    if ((await stripe(`/checkout/sessions/${setups.session_id}`)).status === 'complete') break
    const fullName = await visible(f => f.getByRole('textbox', { name: 'Full name', exact: true }))
    if (fullName && !await fullName.inputValue()) await fullName.fill('Synthetic Pantry')
    const autofill = await visible(f => f.getByRole('button', { name: 'Autofill', exact: true }))
    if (autofill) {
      await autofill.click()
      await stage(`bank-details-${step}`)
      await autofill.waitFor({ state: 'hidden', timeout: 15000 })
    } else {
      const finish = await visible(f => f.getByText('Finish without saving', { exact: true }))
      if (finish) { await finish.click(); await page.waitForTimeout(750); continue }
      const manual = await visible(f => f.getByText(/enter bank details manually|manually enter bank details|enter bank details instead/i))
      if (manual) {
        await manual.click()
        await findInFrames(f => f.getByRole('button', { name: 'Autofill', exact: true }))
      }
      else {
        const connect = await visible(f => f.getByRole('button', { name: /connect bank account|add bank account|link bank account|choose bank/i }))
        if (connect) await connect.click()
        else {
          const final = await visible(f => f.getByRole('button', { name: /^(save|set up|set up bank account|start setup|agree and save|continue(?: to .+)?|done)$/i }))
          if (final) await final.click()
          else await page.waitForTimeout(1000)
        }
      }
    }
    await page.waitForTimeout(750)
    await stage(`hosted-stage-${step}`, page, false)
  }
  let session = await stripe(`/checkout/sessions/${setups.session_id}?expand[]=setup_intent`)
  receipt.checkoutSession = session.id; receipt.setupIntent = session.setup_intent?.id; receipt.checkoutStatus = session.status; receipt.setupStatus = session.setup_intent?.status
  await retain()
  let intent = session.setup_intent
  if (intent?.status === 'requires_action' && intent.next_action?.type === 'verify_with_microdeposits') intent = await stripe(`/setup_intents/${intent.id}/verify_microdeposits`, { descriptor_code: 'SM11AA' })
  session = await stripe(`/checkout/sessions/${setups.session_id}?expand[]=setup_intent`)
  assert.equal(intent?.status, 'succeeded', 'Hosted ACH setup has not completed')
  assert.equal(session.status, 'complete', 'Checkout has not completed')
  receipt.setupStatus = intent.status
  await page.goto(`${app.origin}/i/${invoice.link_token}?autopay_setup=${session.id}`)
  await page.getByText(/Saved ACH bank account.*Autopay authorized/).waitFor()
  await stage('saved-ach-mandate')
  const saved = await view(`autopay/${customer.id}`)
  assert.equal(saved.saved.active, true); assert.ok(saved.saved.acceptedAt); assert.ok(saved.saved.acceptedIP); assert.match(saved.saved.mandateText, /electronic debits/)
  receipt.authorization = { active: saved.saved.active, textRetained: !!saved.saved.mandateText, acceptedAt: saved.saved.acceptedAt, trustedIpRetained: !!saved.saved.acceptedIP }
  const due = invoice.due_date
  await app.cron(Date.parse(due + 'T16:00:00Z'))
  let state = await view(`autopay/${customer.id}`)
  assert.equal(state.attempts.length, 1)
  receipt.attemptId = state.attempts[0].id; receipt.paymentIntent = state.attempts[0].payment_intent; receipt.scheduledOn = state.attempts[0].scheduled_on
  for (let i = 0; i < 30 && state.attempts[0].status === 'processing'; i++) { await page.waitForTimeout(2000); await app.cron(Date.parse(due + 'T16:00:00Z')); state = await view(`autopay/${customer.id}`) }
  receipt.paymentStatus = state.attempts[0].status
  const providerIntent = await stripe(`/payment_intents/${receipt.paymentIntent}`)
  assert.equal(providerIntent.livemode, false); assert.equal(providerIntent.amount, 100)
  assert.ok(['processing', 'succeeded'].includes(providerIntent.status))
  await command('autopay.revoke', { customerId: customer.id })
  await app.cron(Date.parse(due + 'T16:00:00Z'))
  assert.equal((await view(`autopay/${customer.id}`)).attempts.length, 1)
  await declinedCard({ app, browser, headers, command, view, acct, day, stripe, receipt, retain, stage })
  receipt.revoked = true; receipt.status = providerIntent.status === 'succeeded' ? 'completed' : 'processing'; receipt.stage = 'retained-provider-outcome'
  await retain()
  console.log(JSON.stringify(receipt))
  }
} catch (error) {
  receipt.status = 'blocked'
  receipt.reason = 'The live hosted setup or provider outcome did not complete; inspect the retained private stage screenshots.'
  const diagnostic = String(error.stack)
    .replace(/\b(?:seti|pi)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+\b/g, '[redacted Stripe capability]')
    .replace(/\b(?:sk|rk)_test_[A-Za-z0-9]+\b/g, '[redacted test credential]')
    .replace(/https:\/\/checkout\.stripe\.com\/[^\s"'<>]+/g, 'https://checkout.stripe.com/[redacted]')
  await writeFile(join(proof, 'autopay-provider-error.txt'), diagnostic, { mode: 0o600 })
  await retain()
  if (page) await page.screenshot({ path: join(proof, 'autopay-provider-blocked.png'), fullPage: true }).catch(() => {})
  console.log(JSON.stringify(receipt))
  process.exitCode = 1
} finally {
  await browser?.close()
  await app?.close()
}
