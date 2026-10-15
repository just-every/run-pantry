// The real Pantry Worker (its auth and API) on Miniflare with a real D1
// database, every migration applied, and genuine sign-ins: the owner by the
// bootstrap token, everyone else by an emailed invitation link. Mail leaves
// through the real Resend adapter; only its HTTP endpoint is faked here.
import { createServer } from 'node:net'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

const BOOTSTRAP = 'local-test-bootstrap-token-0123456789'

async function freePort() {
  const socket = createServer()
  await new Promise(r => socket.listen(0, '127.0.0.1', r))
  const { port } = socket.address()
  await new Promise(r => socket.close(r))
  return port
}

export const fixture = (path) => readFile(new URL(`../../fixtures/${path}`, import.meta.url), 'utf8')

export async function harness() {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`
  const dir = await mkdtemp(join(tmpdir(), 'pantry-test-'))
  const mail = []
  const bundle = await build({ entryPoints: ['tests/api/worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2023', logLevel: 'error' })
  const mf = new Miniflare({ ...convertV4MiniflareOptions({
    host: '127.0.0.1', port, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'pantry' },
    bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'local-test-secret-not-production-0123456789', SETUP_TOKEN: BOOTSTRAP, MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'test-resend-key', MAIL_FROM: 'Pantry <pantry@example.test>' },
    async outboundService(request) {
      assert.equal(new URL(request.url).href, 'https://api.resend.com/emails', `unexpected outbound ${request.method} ${request.url}`)
      mail.push(await request.json())
      return Response.json({ id: `test-${mail.length}` })
    },
  }), resourcePersistencePath: dir })
  try {
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort())
      await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(sql => db.prepare(sql)))

    async function send(path, body, { cookie = '', method, headers = {} } = {}) {
      const r = await mf.dispatchFetch(origin + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', cookie, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' })
      const text = await r.text()
      let value; try { value = JSON.parse(text) } catch { value = text }
      return { status: r.status, value, cookie: r.headers.get('set-cookie')?.split(';')[0], headers: r.headers }
    }
    const boot = await send('/auth/bootstrap', { token: BOOTSTRAP, displayName: 'Olivia Owner' })
    assert.equal(boot.status, 303, JSON.stringify(boot.value))
    const owner = boot.cookie

    async function confirmMail(email) {
      const message = mail.findLast(m => [m.to].flat().includes(email))
      assert.ok(message, `no mail for ${email}`)
      const token = new URL(message.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
      const confirmed = await send('/auth/confirm', { token })
      assert.equal(confirmed.status, 303, JSON.stringify(confirmed.value))
      return confirmed.cookie
    }

    /** POST a command; asserts the status (200 unless given). */
    async function command(op, body, cookie = owner, status = 200) {
      const r = await send('/api/pantry/command/' + op, body, { cookie })
      assert.equal(r.status, status, `${op}: ${JSON.stringify(r.value)}`)
      return r.value
    }
    async function view(path, cookie = owner, status = 200) {
      const r = await send('/api/pantry/' + path, undefined, { cookie })
      assert.equal(r.status, status, `${path}: ${JSON.stringify(r.value)}`)
      return r.value
    }
    /** Add a person with a Pantry role and sign them in through their invitation. */
    async function member(email, role, grants = {}) {
      await command('member.save', { email, name: email.split('@')[0], role, ...grants })
      await command('member.invite', { email })
      return confirmMail(email)
    }
    async function agent(name = 'books-agent') {
      const { token } = await command('agent.create', { name })
      const call = async (path, body, status = 200) => {
        const r = await send('/api/pantry/agent/' + path, body, { headers: { authorization: `Bearer ${token}` } })
        assert.equal(r.status, status, `agent ${path}: ${JSON.stringify(r.value)}`)
        return r.value
      }
      return { token, call }
    }
    const close = async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }) }
    return { db, origin, owner, send, command, view, member, agent, confirmMail, close }
  } catch (error) {
    await mf.dispose(); await rm(dir, { recursive: true, force: true })
    throw error
  }
}

/** The business, a small chart and roles most flows start from. */
export async function books(h) {
  await h.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: 'Revenue recognised when invoiced.' })
  await h.command('chart.start', {})
  const state = await h.view('state')
  const acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  return { acct, state }
}

export const at = (list, pred) => { const x = list.find(pred); assert.ok(x, 'expected record not found'); return x }
