import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createPortability } from '@runeditrun/rer/modules/portability'
import { exportArchive } from '@runeditrun/rer/modules/portability/files'
import policy from '../../src/pantry/archive-policy.mjs'
const accountId='a'.repeat(32)

export const restoreEnvironment = {
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN: 'synthetic-pantry-986',
}

// The harness applies real migrations directly. Record that same applied
// history, as the hosted deploy kit does, so restore can replay seed rows.
export async function recordHostedMigrations(db) {
  await db.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sha256 TEXT, state TEXT)').run()
  const files = (await readdir('migrations/core')).filter(name => name.endsWith('.sql')).sort()
  for (const name of files) {
    const sha = createHash('sha256').update(await readFile('migrations/core/' + name)).digest('hex')
    await db.prepare("INSERT INTO d1_migrations(name,sha256,state) VALUES(?,?,'applied')").bind(name, sha).run()
  }
}

export async function saveHostedArchive(db, path) {
  const service = await createPortability({ db, policy })
  return exportArchive(service, path, [])
}

// Only the provider boundary is substituted: every SQL statement and atomic
// batch below executes against the destination's real migrated D1 binding.
export function cloudflareEdge(db) {
  const id = '11111111-2222-4333-8444-555555555555'
  let calls = 0
  return {
    get calls() { return calls },
    async fetch(address, options) {
      calls++
      const url = new URL(address)
      assert.equal(url.origin, 'https://api.cloudflare.com')
      assert.equal(options.headers.authorization, `Bearer ${restoreEnvironment.CLOUDFLARE_API_TOKEN}`)
      assert.equal(options.redirect, 'error')
      const base = `/client/v4/accounts/${accountId}/d1/database`
      if (options.method === 'GET') {
        assert.equal(url.pathname, base)
        assert.equal(url.searchParams.get('name'), 'pantry-ops-i987-db')
        return Response.json({ success: true, result: [{ name: 'pantry-ops-i987-db', uuid: id }] })
      }
      assert.equal(options.method, 'POST')
      assert.equal(url.pathname, `${base}/${id}/query`)
      const body = JSON.parse(options.body)
      const prepare = ({ sql, params = [] }) => {
        const values = params.map(value => Array.isArray(value) ? Uint8Array.from(value).buffer : value)
        return values.length ? db.prepare(sql).bind(...values) : db.prepare(sql)
      }
      try {
        const result = body.batch ? await db.batch(body.batch.map(prepare)) : [await prepare(body).all()]
        // Cloudflare serializes binary result cells as byte arrays, rather
        // than exposing the binding's in-process ArrayBuffer objects.
        return Response.json({ success: true, result: result.map(value => ({
          ...value,
          results: value.results.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell instanceof ArrayBuffer ? Array.from(new Uint8Array(cell)) : cell]))),
        })) })
      } catch {
        return Response.json({ success: false, errors: [{ code: 7500, message: 'Synthetic provider query refusal' }], result: [] }, { status: 400 })
      }
    },
  }
}

export async function restoredSnapshot(h, documentId) {
  const report = await h.view('reports/trial-balance?to=2026-09-30&basis=accrual')
  const ledger = await h.view('reports/general-ledger?from=2026-01-01&to=2026-12-31&basis=accrual')
  const response = await fetch(`${h.origin}/api/pantry/documents/${documentId}`, { headers: { cookie: h.owner } })
  assert.equal(response.status, 200)
  const bytes = Buffer.from(await response.arrayBuffer()).toString('hex')
  const documents = (await h.db.prepare('SELECT id,name,media_type,size,sha256,linked_kind,linked_id FROM pt_documents ORDER BY id').all()).results
  return { report, ledger, documents, bytes }
}

export async function domainImage(db) {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pt_%' ORDER BY name").all()).results
  const image = []
  for (const { name } of tables) {
    const { results } = await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
    const rows = results.map(row => JSON.stringify(row, (_key, value) => value instanceof ArrayBuffer ? { bytes: Buffer.from(value).toString('hex') } : value)).sort()
    image.push({ name, rows })
  }
  return image
}
