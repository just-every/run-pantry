// Real sibling installations, using their maintained public-handler harnesses.
// Only those harnesses' mail edges are faked; no sibling API answers are invented.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function realSiblings(t) {
  const pantry = process.cwd()
  const open = async (name, variable) => {
    assert.ok(process.env[variable], `${variable} must name the sibling checkout with its dependencies installed`)
    const root = resolve(process.env[variable])
    try {
      process.chdir(root)
      const { harness } = await import(pathToFileURL(resolve(root, 'tests/harness.mjs')))
      const h = await harness()
      t.after(() => h.close())
      return h
    } finally { process.chdir(pantry) }
  }
  const inkwell = await open('Inkwell', 'PANTRY_INKWELL_REPO')
  const platter = await open('Platter', 'PANTRY_PLATTER_REPO')
  const outbound = async request => {
    const url = new URL(request.url)
    const app = url.hostname === 'inkwell.example.test' ? inkwell : url.hostname === 'platter.example.test' ? platter : null
    assert.ok(app, 'only the explicitly selected sibling origin is contacted')
    const headers = new Headers(request.headers)
    headers.set('host', new URL(app.origin).host)
    headers.delete('origin')
    return app.mf.dispatchFetch(app.origin + url.pathname + url.search, { method: request.method, headers,
      ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.arrayBuffer() }), redirect: 'manual' })
  }
  return { inkwell, platter, outbound }
}

export async function signedEstimate(h, pdf, customer) {
  const result = await h.command('envelope.prepare', { title: 'Cedar Workshop estimate', filename: 'estimate.pdf', pdfBase64: Buffer.from(pdf).toString('base64'),
    signers: [{ name: 'Casey Cedar', email: customer.email }], fields: [{ id: 'customer-signature', label: 'Customer signature', type: 'signature', signer: 0, page: 0, x: .1, y: .78, width: .4, height: .05 }] })
  const id = result.result.id
  await h.command('envelope.approve', { id, eligible: true })
  const invitation = await h.mail(customer.email, 'Please sign:')
  assert.ok(invitation, 'Inkwell sent its actual signer invitation')
  const path = '/api/sign/' + new URL(invitation.text.match(/http:\/\/[^\s]+\/sign\/[^\s]+/)[0]).pathname.split('/').at(-1)
  await h.post(path + '/code', {}, '')
  const code = (await h.mail(customer.email, 'verification code')).text.match(/\b\d{6}\b/)[0]
  const verified = await h.post(path + '/verify', { code }, '')
  await h.agree(path, verified.cookie)
  await h.post(path + '/sign', { values: { 'customer-signature': 'Casey Cedar' }, consent: true, commandId: crypto.randomUUID() }, verified.cookie)
  const actor = (await h.send('/api/inkwell', undefined, h.owner)).value.actor
  const issued = (await h.post('/api/inkwell/api-keys', { memberId: actor.id, scopes: ['artifacts:read'], name: 'Pantry estimate proof', commandId: crypto.randomUUID() })).value
  return { id, token: issued.token }
}

export async function acceptedProposal(h, customer) {
  const client = await h.cmd('client.save', { name: customer.name, email: customer.email })
  const proposal = await h.cmd('proposal.prepare', { clientId: client.id, title: 'Cedar brand and website', scope: 'Brand strategy, design and launch of the Cedar Workshop website.', optionOne: 'Agreed project', priceOne: '12000', optionTwo: 'Extended project', priceTwo: '18000', depositPercent: '25' })
  await h.cmd('proposal.approve', { id: proposal.id, version: 1, revision: 1 })
  const shared = await h.cmd('proposal.send', { id: proposal.id, version: 2 })
  const path = new URL(shared.shareUrl).pathname
  let response = await h.send(path + '/action?name=code.request', {})
  assert.equal(response.status, 200, response.text)
  const mail = (await h.state()).outbox.find(message => message.subject.includes('verification code'))
  response = await h.send(path + '/action?name=code.verify', { code: mail.body.match(/\b\d{6}\b/)[0] })
  assert.equal(response.status, 200, response.text)
  const accepted = await h.send(path + '/action?name=accept', { name: 'Casey Cedar', optionId: 'one', consent: true }, response.cookie)
  assert.equal(accepted.status, 200, accepted.text)
  const key = await h.cmd('agent.create', { label: 'Pantry selected proposal read' })
  return { id: proposal.id, token: key.token }
}
