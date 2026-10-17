// This checkout's Worker on an upgraded book's D1, at the address the books were
// made on (sessions are bound to it), asserting it reads what the previous
// release showed. `before` is what populate.mjs saved; `persist` is the D1's
// Miniflare persistence directory (wrangler's <persist-to>/v3).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

// What the owner reads, field by field; each pick must find its rows before the upgrade.
const rows = (list, f) => { assert.ok(Array.isArray(list) && list.length, 'view has rows'); return list.map(f) }
// Every statement line keeps its match, and the completed reconciliation keeps its proof.
const reconciliation = v => { assert.ok(v.completed, 'reconciled'); return { statement: v.statement.id, closing: v.closing, book: v.book, difference: v.difference, proof: v.completed.proof, lines: rows(v.lines, l => { assert.ok(l.match_id, 'line matched'); return [l.id, l.description, l.amount_cents, l.match_id] }) } }
const picks = statements => ({
  'reports/trial-balance?to=2026-09-30': v => rows(v.rows, r => [r.code, r.debit, r.credit]),
  'reports/profit-and-loss?from=2026-09-01&to=2026-09-30': v => ({ income: rows(v.income, r => [r.code, r.amount]), expenses: rows(v.expenses, r => [r.code, r.amount]) }),
  'reports/balance-sheet?to=2026-09-30': v => ({ assets: rows(v.assets, r => [r.code, r.amount]), liabilities: (v.liabilities ?? []).map(r => [r.code, r.amount]), equity: rows(v.equity, r => [r.code, r.amount]) }),
  'journal': v => rows(v.entries, e => [e.number, e.entry_date, e.status, e.memo, e.reverses_id, e.reversed_by_id, rows(e.lines, l => [l.account_id, l.debit_cents, l.credit_cents])]),
  [`reconciliation/${statements.checking}`]: reconciliation,
  [`reconciliation/${statements.savings}`]: reconciliation,
  'close/2026-09': v => ({ status: v.status, locked: v.period?.status }),
  'documents': v => rows(v.documents, d => [d.id, d.name, d.sha256, d.linked_kind, d.linked_id]),
})

export async function readUpgraded(root, persist, before) {
  const migrations = (await readdir(join(root, 'migrations/core'))).filter(f => f.endsWith('.sql')).sort()
  const origin = before.origin
  const bundle = await build({ entryPoints: [join(root, 'tests/api/worker.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2023', logLevel: 'error' })
  const mf = new Miniflare({ ...convertV4MiniflareOptions({
    host: '127.0.0.1', port: Number(new URL(origin).port), modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'pantry' },
    bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'local-test-secret-not-production-0123456789', SETUP_TOKEN: 'local-test-bootstrap-token-0123456789', MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'test-resend-key', MAIL_FROM: 'Pantry <pantry@example.test>' },
    outboundService: request => { throw new Error(`unexpected outbound ${request.method} ${request.url}`) },
  }), resourcePersistencePath: persist })
  try {
    const db = await mf.getD1Database('DB')
    const after = { pending: migrations.filter(m => !before.migrations.includes(m)), counts: {}, views: {} }
    const applied = (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map(r => r.name)
    assert.deepEqual(applied, migrations, 'every migration is recorded, ending at the newest')
    after.lastMigration = applied.at(-1)
    after.foreignKeyViolations = (await db.prepare('PRAGMA foreign_key_check').all()).results
    assert.deepEqual(after.foreignKeyViolations, [], 'no foreign key violations')
    for (const table of Object.keys(before.counts)) after.counts[table] = (await db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).first()).n
    assert.deepEqual(after.counts, before.counts, 'every previous release table keeps its rows')

    const send = async (path, body, cookie = before.owner) => {
      const r = await mf.dispatchFetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' })
      const text = await r.text(); let value; try { value = JSON.parse(text) } catch { value = text }
      return { status: r.status, value }
    }
    const owner = await send('/api/pantry/state')
    assert.equal(owner.status, 200, JSON.stringify(owner.value).slice(0, 400))
    assert.equal(owner.value.actor?.role, 'owner', 'the owner stays signed in')
    assert.equal((await send('/api/pantry/state', undefined, before.accountant)).value.actor?.role, 'accountant', 'the accountant stays signed in')
    for (const [path, pick] of Object.entries(picks(before.statements))) {
      const now = await send('/api/pantry/' + path)
      assert.equal(now.status, 200, `${path}: ${JSON.stringify(now.value).slice(0, 400)}`)
      assert.deepEqual(pick(now.value), pick(before.views[path]), `${path} reads the same`)
      after.views[path] = 'same'
    }
    for (const d of before.documents) {
      const r = await mf.dispatchFetch(`${origin}/api/pantry/documents/${d.id}`, { headers: { host: new URL(origin).host, cookie: before.owner } })
      assert.equal(r.status, 200, `document ${d.name}`)
      assert.equal(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'), d.sha256, `document ${d.name} keeps its bytes`)
      after.views[`document ${d.name}`] = 'same bytes'
    }
    const acct = Object.fromEntries(owner.value.accounts.map(a => [a.code, a.id]))
    const vendor = owner.value.contacts.find(c => c.kind === 'vendor')
    const late = await send('/api/pantry/command/bill.save', { vendorId: vendor.id, reference: 'LATE-9', billDate: '2026-09-15', lines: [{ description: 'Late', accountId: acct['6500'], amount: '40.00' }], post: true })
    assert.equal(late.status, 409, `the locked month refuses a bill: ${JSON.stringify(late.value).slice(0, 400)}`)
    after.lockedMonthRefusesBill = late.status
    return after
  } finally {
    await mf.dispose()
  }
}
