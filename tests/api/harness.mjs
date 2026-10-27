// The real Pantry Worker (its auth and API) on Miniflare with a real D1
// database, every migration applied, and genuine sign-ins: the owner by the
// bootstrap token, everyone else by an emailed invitation link. Mail leaves
// through the real Resend adapter; only its HTTP endpoint is faked here, as is
// the AI model's (`model`) when a test reads receipts, and any other provider
// edge (Stripe) a test answers with `outbound`.
import { startWorker } from '../start-worker.mjs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

const BOOTSTRAP = 'local-test-bootstrap-token-0123456789'

export const fixture = (path) => readFile(new URL(`../../fixtures/${path}`, import.meta.url), 'utf8')

/** `bindings` extend the Worker's; `outbound` answers any request not bound for the mail provider; `entry` swaps the Worker entry. */
export async function harness({ bindings = {}, outbound, log, entry = 'tests/api/worker.ts', beforeMigration, clock, sessionClock, r2Buckets = {} } = {}) {
  let mf,origin
  const dir = await mkdtemp(join(tmpdir(), 'pantry-test-'))
  const mail = []
  const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2023', logLevel: 'error' })
  const optionsFor = origin => ({ ...convertV4MiniflareOptions({
    host: '127.0.0.1', port:0, modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'], ...(log ? { log } : {}),
    d1Databases: { DB: 'pantry' }, r2Buckets, unsafeTriggerHandlers: true,
    bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'local-test-secret-not-production-0123456789', SETUP_TOKEN: BOOTSTRAP, MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'test-resend-key', MAIL_FROM: 'Pantry <pantry@example.test>', ...bindings },
    async outboundService(request) {
      if (outbound && new URL(request.url).hostname !== 'api.resend.com') return outbound(request)
      assert.equal(new URL(request.url).href, 'https://api.resend.com/emails', `unexpected outbound ${request.method} ${request.url}`)
      mail.push(await request.json())
      return Response.json({ id: `test-${mail.length}` })
    },
  }), resourcePersistencePath: dir })
  try {
    ({mf,origin}=await startWorker(optionsFor))
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort()) {
      await beforeMigration?.(db, file)
      await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(sql => db.prepare(sql)))
    }

    /** A request through the public door; `raw` sends a body as given (a form post) instead of JSON. */
    async function send(path, body, { cookie = '', method, headers = {}, raw } = {}) {
      const r = await mf.dispatchFetch(origin + path, { method: method ?? (body === undefined && raw === undefined ? 'GET' : 'POST'), headers: { ...(clock && !path.startsWith('/auth/') ? {'x-synthetic-pantry-clock':clock} : {}), host: new URL(origin).host, origin, 'content-type': 'application/json', cookie, ...headers }, ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' })
      const text = await r.text()
      let value; try { value = JSON.parse(text) } catch { value = text }
      return { status: r.status, value, cookie: r.headers.get('set-cookie')?.split(';')[0], headers: r.headers }
    }
    const bootstrapClock = sessionClock ? new Date(Math.max(Date.now(), Date.parse(sessionClock))).toISOString() : undefined
    const boot = await send('/auth/bootstrap', { token: BOOTSTRAP, displayName: 'Olivia Owner' }, {headers: bootstrapClock ? {'x-synthetic-pantry-clock':bootstrapClock} : {}})
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
    /** Add a person with a Pantry role (which emails their invitation) and sign them in through it. */
    async function member(email, role, grants = {}) {
      // Invitations use the same real session clock as confirmation; a pinned
      // accounting date must not create an already-expired sign-in link.
      const response = await send('/api/pantry/command/member.save', { email, name: email.split('@')[0], role, ...grants }, { cookie: owner, headers: { 'x-synthetic-pantry-clock': new Date().toISOString() } })
      assert.equal(response.status, 200, JSON.stringify(response.value))
      const added = response.value
      assert.deepEqual([added.invited, added.emailed], [email, true])
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
    /** Deliver one email to the Worker's email handler, as Cloudflare Email Routing does. */
    async function email(raw, { from, to }) {
      const r = await mf.dispatchFetch(`${origin}/cdn-cgi/local/email?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: 'POST', body: raw })
      return { status: r.status, text: await r.text() }
    }
    /** Fire the Worker's Cron trigger. */
    const cron = async (scheduledTime=clock ? Date.parse(clock) : Date.now()) => (await mf.getWorker()).scheduled({ cron: '*/30 * * * *',scheduledTime })
    const close = async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }) }
    return { db, bucket: name => mf.getR2Bucket(name), origin, owner, mail, send, command, view, member, agent, confirmMail, email, cron, close }
  } catch (error) {
    await mf?.dispose(); await rm(dir, { recursive: true, force: true })
    throw error
  }
}

/** The business, a small chart and roles most flows start from. */
export async function books(h) {
  await h.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: 'Revenue recognized when invoiced.' })
  await h.command('chart.start', {})
  const state = await h.view('state')
  const acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  return { acct, state }
}

export const at = (list, pred) => { const x = list.find(pred); assert.ok(x, 'expected record not found'); return x }
