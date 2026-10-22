import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { harness, books } from '../api/harness.mjs'
import { realSiblings, signedEstimate, acceptedProposal } from './harness.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
test('Estimates retain a real Inkwell signature and accepted Platter proposal through their authenticated public APIs', async t => {
  const siblings = await realSiblings(t)
  const h = await harness({ outbound: siblings.outbound }); t.after(() => h.close())
  const { acct } = await books(h)
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Cedar Workshop', email: 'synthetic-pantry-71@example.test' })
  let estimate = await h.command('estimate.save-draft', { customerId: customer.id, issueDate: '2026-10-21', lines: [{ description: 'Brand and website project', quantity: '1', rate: '12000', accountId: acct['4000'], taxCode: 'exempt' }] })
  estimate = await h.command('estimate.send', { id: estimate.id, revision: estimate.revision })
  const response = await fetch(`${h.origin}/api/pantry/estimates/${estimate.id}/pdf`, { headers: { cookie: h.owner } })
  assert.equal(response.status, 200)
  const pdf = new Uint8Array(await response.arrayBuffer())
  assert.equal(digest(pdf), estimate.pdf_sha256)
  const inkwell = await signedEstimate(siblings.inkwell, pdf, customer)
  const platter = await acceptedProposal(siblings.platter, customer)
  const before = await h.view('reports/trial-balance?from=2026-10-01&to=2026-10-31')
  for (const [provider, source] of [['inkwell', inkwell], ['platter', platter]]) {
    const prepared = await h.command('estimate.sibling-preview', { id: estimate.id, revision: estimate.revision, provider, origin: `https://${provider}.example.test`, remoteId: source.id, token: source.token })
    assert.equal(prepared.ok, true, JSON.stringify(prepared))
    assert.equal(prepared.preview.summary.total_cents, 1200000)
    assert.ok(!JSON.stringify(prepared).includes(source.token))
    const confirmed = await h.command('estimate.sibling-confirm', { id: estimate.id, revision: estimate.revision, previewId: prepared.preview.id, previewRevision: prepared.preview.revision })
    const again = await h.command('estimate.sibling-confirm', { id: estimate.id, revision: estimate.revision, previewId: prepared.preview.id, previewRevision: prepared.preview.revision })
    assert.equal(again.link.id, confirmed.link.id)
    assert.equal(confirmed.link.estimate_revision, estimate.revision)
    if (provider === 'inkwell') {
      assert.equal(confirmed.link.summary.original_sha256, estimate.pdf_sha256)
      const artifact = await fetch(h.origin + confirmed.link.document_href, { headers: { cookie: h.owner } })
      assert.equal(artifact.status, 200)
      assert.equal(digest(new Uint8Array(await artifact.arrayBuffer())), confirmed.link.pdf_sha256)
    } else {
      assert.equal(confirmed.link.summary.deposit_cents, 300000)
      assert.equal(confirmed.link.summary.money_received, false)
    }
  }
  const linked = await h.view(`estimates/${estimate.id}/siblings`)
  assert.equal(linked.links.length, 2)
  assert.deepEqual(linked.attempts, [])
  const current = await h.view(`estimates/${estimate.id}`)
  assert.equal(current.status, 'sent'); assert.equal(current.acceptance, null)
  assert.equal(current.billed_cents, 0)
  assert.deepEqual((await h.view('customer-deposits')).deposits, [])
  assert.deepEqual(await h.view('reports/trial-balance?from=2026-10-01&to=2026-10-31'), before)
  const viewer = await h.member('synthetic-pantry-72@example.test', 'viewer')
  await h.view(`estimates/${estimate.id}/siblings`, viewer, 403)
  const history = await h.view(`customers/${customer.id}/history`)
  assert.ok(JSON.stringify(history).includes(estimate.id), 'customer history drills to the linked estimate')
  // Only identity/source hashes are kept; a source credential is never custody evidence.
  for (const table of ['pt_estimate_sibling_links', 'pt_estimate_sibling_previews', 'pt_audit']) {
    const rows = JSON.stringify((await h.db.prepare(`SELECT * FROM ${table}`).all()).results)
    assert.ok(!rows.includes(inkwell.token) && !rows.includes(platter.token))
  }
})
