import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { expect } from '@playwright/test'
const digest = value => createHash('sha256').update(value).digest('hex')

// Only these upstream HTTP responses are faked. The installation journey uses
// real sibling Workers; this journey uses Pantry's actual built UI and handlers.
export async function siblingEdge(request, state) {
  assert.equal(request.headers.get('authorization'), 'Bearer synthetic-pantry-91')
  const url = new URL(request.url)
  if (state.refused) return Response.json({ error: 'Source credential revoked' }, { status: 401 })
  if (url.hostname === 'inkwell.example.test') {
    if (url.pathname.endsWith('/handoff')) return Response.json({ format: 'inkwell-handoff/1', envelopeId: `envelope-${state.width}`, title: 'Cedar website engagement', status: 'completed', originalSha256: state.originalHash, signedSha256: digest(state.pdf), executedOn: '2026-10-21T15:30:00.000Z', signers: [{ name: 'Casey Cedar', email: state.email, signedAt: '2026-10-21T15:30:00.000Z' }] })
    assert.ok(url.pathname.endsWith('/signed'))
    return new Response(state.pdf, { headers: { 'content-type': 'application/pdf' } })
  }
  assert.equal(url.hostname, 'platter.example.test')
  const message = await request.json()
  if (message.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18' } })
  assert.equal(message.method, 'tools/call'); assert.equal(message.params.name, 'read_proposal')
  const proposal = { id: `proposal-${state.width}`, title: 'Brand and website project', scope: 'Brand strategy, design and launch of the Cedar Workshop website.', status: 'accepted', revision: 1, currency: 'USD', options: [{ id: 'one' }], acceptance: { revision: 1, name: 'Casey Cedar', email: state.email, optionId: 'one', totalCents: 1200000, depositCents: 300000, currency: 'USD', acceptedAt: Date.parse('2026-10-21T15:30:00Z') } }
  return Response.json({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(proposal) }] } })
}

export async function siblingBrowser(page, origin, estimate, customer, pdf, width, evidence, state) {
  Object.assign(state, { width, email: customer.email, originalHash: estimate.pdf_sha256, pdf: Buffer.concat([pdf, Buffer.from('\n% synthetic-pantry-92 network-edge signed document\n')]), refused: false })
  await page.goto(`${origin}/app/sales?tab=estimates&estimate=${estimate.id}`)
  const form = async provider => {
    await page.getByLabel('Source app', { exact: true }).selectOption(provider)
    await page.getByLabel(`${provider === 'inkwell' ? 'Inkwell' : 'Platter'} installation origin`, { exact: true }).fill(`https://${provider}.example.test`)
    await page.getByLabel(provider === 'inkwell' ? 'Completed envelope ID' : 'Accepted proposal ID', { exact: true }).fill(`${provider === 'inkwell' ? 'envelope' : 'proposal'}-${width}`)
    await page.getByLabel('Source access token', { exact: true }).fill('synthetic-pantry-91')
  }
  const review = 'I reviewed the customer, amounts, source revision and document hashes for this exact estimate revision.'
  for (const provider of ['inkwell', 'platter']) {
    await form(provider)
    await page.getByRole('heading', { name: 'Inkwell signatures and Platter proposals', exact: true }).locator('..').locator('..').screenshot({ path: `${evidence}/estimate-${provider}-source-${width}.png` })
    await page.getByRole('button', { name: 'Preview external record', exact: true }).click()
    await expect(page.getByRole('heading', { name: `Review ${provider === 'inkwell' ? 'Inkwell' : 'Platter'} record`, exact: true })).toBeVisible()
    await expect(page.getByLabel('Source access token', { exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Attach reviewed record', exact: true })).toBeDisabled()
    await page.getByLabel(review, { exact: true }).check()
    await page.getByRole('heading', { name: `Review ${provider === 'inkwell' ? 'Inkwell' : 'Platter'} record`, exact: true }).locator('..').locator('..').screenshot({ path: `${evidence}/estimate-${provider}-review-${width}.png` })
    await page.getByRole('button', { name: 'Attach reviewed record', exact: true }).click()
    const links = page.getByRole('heading', { name: 'Attached signatures and proposals', exact: true }).locator('..').locator('..')
    await expect(links.getByText(provider === 'inkwell' ? 'Cedar website engagement · completed' : 'Brand and website project · accepted', { exact: true })).toBeVisible()
    await links.screenshot({ path: `${evidence}/estimate-${provider}-attached-${width}.png` })
  }
  state.refused = true
  await form('inkwell')
  await page.getByRole('button', { name: 'Preview external record', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('heading', { name: 'Inkwell signatures and Platter proposals', exact: true }).locator('..').locator('..').screenshot({ path: `${evidence}/estimate-source-error-${width}.png` })
  state.refused = false
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `external records fit ${width}`)
}
