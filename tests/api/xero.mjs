// Xero at the network edge: recorded responses (fixtures/xero-api, in the
// shapes Xero's OpenAPI description documents) for sign-in, the tenant list,
// invoices filtered by number, and each invoice's attachments and file bytes.
import { readFile } from 'node:fs/promises'
import { fixture } from './harness.mjs'

const CLIENT = { id: 'test-xero-client-id', secret: 'test-xero-client-secret' }
const load = async name => JSON.parse(await fixture(`xero-api/${name}.json`))
const bytes = name => readFile(new URL(`../../fixtures/xero-api/files/${name}`, import.meta.url))

export async function fakeXero() {
  const token = await load('token-authorization-code'), tenants = await load('connections'), invoices = await load('invoices'), lists = await load('attachments')
  const tenant = tenants.find(t => t.tenantName === 'Juniper Lane Design LLC').tenantId
  const state = { calls: [], codes: new Set(['recorded-authorization-code']), revoked: [] }
  const answer = (value, status = 200) => Response.json(value, { status })
  const files = Object.values(lists).flatMap(l => l.Attachments)

  async function outbound(request) {
    const url = new URL(request.url), auth = request.headers.get('authorization') ?? ''
    state.calls.push(`${request.method} ${url.host}${url.pathname}`)
    if (url.host === 'identity.xero.com') {
      if (auth !== `Basic ${btoa(`${CLIENT.id}:${CLIENT.secret}`)}`) return answer({ error: 'invalid_client' }, 400)
      const form = new URLSearchParams(await request.text())
      if (url.pathname === '/connect/revocation') { state.revoked.push(form.get('token')); return new Response(null, { status: 200 }) }
      if (url.pathname !== '/connect/token') throw new Error(`unrecorded Xero identity call ${url.pathname}`)
      if (form.get('grant_type') === 'authorization_code' && state.codes.delete(form.get('code'))) return answer(token)
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === token.refresh_token) return answer(token)
      return answer({ error: 'invalid_grant' }, 400)
    }
    if (url.host !== 'api.xero.com') throw new Error(`unexpected outbound ${request.method} ${request.url}`)
    if (auth !== `Bearer ${token.access_token}`) return answer({ Title: 'Unauthorized', Status: 401 }, 401)
    if (url.pathname === '/connections') return answer(tenants)
    if (request.method === 'DELETE' && url.pathname.startsWith('/connections/')) return new Response(null, { status: 204 })
    if (request.headers.get('xero-tenant-id') !== tenant) return answer({ Title: 'Forbidden', Detail: 'AuthenticationUnsuccessful' }, 403)
    const path = url.pathname.replace('/api.xro/2.0', '')
    if (path === '/Invoices') {
      const wanted = new Set((url.searchParams.get('InvoiceNumbers') ?? '').split(','))
      const page = Number(url.searchParams.get('page') ?? 1)
      return answer({ ...invoices, Invoices: page === 1 ? invoices.Invoices.filter(i => wanted.has(i.InvoiceNumber)) : [] })
    }
    let m = /^\/Invoices\/([^/]+)\/Attachments$/.exec(path)
    if (m) return lists[m[1]] ? answer({ ...lists[m[1]], Attachments: lists[m[1]].Attachments.map(({ _file, ...a }) => a) }) : answer({ Title: 'Not Found' }, 404)
    m = /^\/Invoices\/([^/]+)\/Attachments\/([^/]+)$/.exec(path)
    if (m) {
      const f = lists[m[1]]?.Attachments.find(a => a.AttachmentID === m[2])
      if (!f?._file) throw new Error(`unrecorded attachment download ${path}`)
      if (request.headers.get('accept') !== f.MimeType) return answer({ Title: 'Not Acceptable' }, 406)
      return new Response(await bytes(f._file), { headers: { 'content-type': f.MimeType } })
    }
    throw new Error(`unrecorded Xero call ${request.method} ${path}`)
  }

  return { outbound, state, token, files, fileBytes: bytes, bindings: { XERO_CLIENT_ID: CLIENT.id, XERO_CLIENT_SECRET: CLIENT.secret } }
}
