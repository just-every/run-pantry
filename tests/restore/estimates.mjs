import assert from 'node:assert/strict'
import { isIP } from 'node:net'

export async function estimatesForRestore(context, origin, siblings) {
  const command = async (op, data) => {
    const r = await context.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data })
    assert.equal(r.status(), 200, `${op}: ${await r.text()}`); return r.json()
  }
  const state = await (await context.request.get(`${origin}/api/pantry/state`)).json()
  const customer = await command('contact.save', { kind: 'customer', name: 'Archive Workshop', email: 'synthetic-pantry-31@example.test' })
  const liability = await command('account.save', { code: '2320', name: 'Archive customer deposits', type: 'liability', subtype: 'other' })
  const income = state.accounts.find(a => a.code === '4000').id
  const bank = state.bankAccounts.find(b => b.account_id === state.accounts.find(a => a.code === '1000').id)
  let estimate = await command('estimate.save-draft', { customerId: customer.id, issueDate: '2026-09-14', validUntil: new Date(Date.now()+7*86400000).toISOString().slice(0,10), lines: [{ description: 'Archive design engagement', quantity: '1', rate: '1200', accountId: income, taxCode: 'exempt' }] })
  estimate = await command('estimate.send', { id: estimate.id, revision: estimate.revision })
  const link = estimate.public_path
  const acceptance = await context.request.post(`${origin}${link}/accept`, { headers: { origin, 'cf-connecting-ip': '192.0.2.55', 'x-forwarded-for': '198.51.100.88' }, form: { name: 'Casey Archive', revision: estimate.revision } })
  assert.equal(acceptance.status(), 200)
  const accepted = await (await context.request.get(`${origin}/api/pantry/estimates/${estimate.id}`)).json()
  const peerIP = accepted.acceptance.ip
  assert.ok(isIP(peerIP), 'native acceptance records the actual peer address')
  assert.ok(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peerIP), 'the native dev socket overwrites spoofed IP headers')
  const deposit = await command('customer-deposit.record', { customerId: customer.id, date: '2026-09-15', amount: '100', bankAccountId: bank.id, liabilityAccountId: liability.id, method: 'ach', reference: 'ARCHIVE-ADVANCE' })
  const conversion = await command('estimate.convert', { id: estimate.id, revision: estimate.revision, requestId: 'synthetic-pantry-32', issueDate: '2026-09-17', mode: 'percent', percent: '25', depositId: deposit.id, depositAmount: '100' })
  const approved = await command('invoice.approve', { id: conversion.invoice.id, revision: conversion.invoice.revision })
  const invoice = await command('invoice.issue', { id: approved.id })
  assert.equal(invoice.open_cents, 20000)
  const preview = await (await context.request.get(`${origin}/api/pantry/estimates/${estimate.id}/preview`)).json()
  const pdf = Buffer.from(await (await context.request.get(`${origin}/api/pantry/estimates/${estimate.id}/pdf`)).body())
  const acceptedPdf=Buffer.from(await (await context.request.get(`${origin}/api/pantry/estimates/${estimate.id}/accepted.pdf`)).body())
  for(const fact of ['Casey Archive',accepted.acceptance.at,estimate.revision]) assert.ok(acceptedPdf.toString().includes(fact))
  const external = []
  if (siblings) {
    const { signedEstimate, acceptedProposal } = await import('../siblings/harness.mjs')
    for (const [provider, source, installation] of [
      ['inkwell', await signedEstimate(siblings.inkwell, pdf, customer), siblings.inkwell],
      ['platter', await acceptedProposal(siblings.platter, customer, '1200'), siblings.platter],
    ]) {
      const prepared = await command('estimate.sibling-preview', { id: estimate.id, revision: estimate.revision, provider, origin: installation.origin, remoteId: source.id, token: source.token })
      assert.equal(prepared.ok, true, JSON.stringify(prepared))
      const attached = await command('estimate.sibling-confirm', { id: estimate.id, revision: estimate.revision, previewId: prepared.preview.id, previewRevision: prepared.preview.revision })
      external.push({ link: attached.link, ...(attached.link.document_href ? { pdf: Buffer.from(await (await context.request.get(origin + attached.link.document_href)).body()) } : {}) })
    }
  }
  return { validity:estimate.validity, acceptedPdf, acceptedSha256:accepted.accepted_pdf_sha256, peerIP, estimateId: estimate.id, depositId: deposit.id, invoiceId: invoice.id, link, document: preview.document, sha256: preview.sha256, pdf, external }
}

export async function assertEstimatesRestored(context, origin, expected) {
  const get = async path => {
    const r = await context.request.get(`${origin}/api/pantry/${path}`)
    assert.equal(r.status(), 200, await r.text()); return r.json()
  }
  if (expected.external.length) {
    const restored = await get(`estimates/${expected.estimateId}/siblings`)
    assert.equal(restored.links.length, expected.external.length)
    assert.deepEqual(restored.previews, [], 'owner preview authority never travels in the archive')
    assert.deepEqual(restored.attempts, [], 'temporary source errors never travel in the archive')
    for (const record of expected.external) {
      const link = restored.links.find(row => row.id === record.link.id)
      assert.deepEqual(link, record.link)
      if (record.pdf) assert.deepEqual(Buffer.from(await (await context.request.get(origin + link.document_href)).body()), record.pdf)
    }
  }
  const estimate = await get(`estimates/${expected.estimateId}`)
  assert.deepEqual(estimate.validity,expected.validity)
  assert.equal(estimate.acceptance.name, 'Casey Archive'); assert.equal(estimate.acceptance.ip, expected.peerIP)
  assert.equal(estimate.public_path, null)
  assert.equal(estimate.accepted_pdf_sha256,expected.acceptedSha256)
  assert.deepEqual(Buffer.from(await (await context.request.get(`${origin}/api/pantry/estimates/${expected.estimateId}/accepted.pdf`)).body()),expected.acceptedPdf)
  assert.equal(estimate.billed_cents, 30000); assert.equal(estimate.remaining_cents, 90000)
  assert.equal(estimate.conversions[0].invoice_id, expected.invoiceId)
  const preview = await get(`estimates/${expected.estimateId}/preview`)
  assert.deepEqual(preview.document, expected.document); assert.equal(preview.sha256, expected.sha256)
  assert.deepEqual(Buffer.from(await (await context.request.get(`${origin}/api/pantry/estimates/${expected.estimateId}/pdf`)).body()), expected.pdf)
  const deposit = (await get('customer-deposits')).deposits.find(d => d.id === expected.depositId)
  assert.equal(deposit.remaining_cents, 0); assert.equal(deposit.applications[0].invoice_id, expected.invoiceId)
  assert.equal((await context.request.get(`${origin}${expected.link}`)).status(), 404)
}
