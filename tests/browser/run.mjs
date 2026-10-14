// Browser and CLI proof from fresh clones of the committed checkout: install,
// setup and dev through `rer`; the owner, bookkeeper and accountant journeys at
// 1440 and 390 wide with a screenshot of every main screen; then export, restore
// into a second installation and compare the restored books.
import { queuedEntrypoint } from '@runeditrun/rer/queued-entry'
const queued = await queuedEntrypoint(import.meta.url, 'test:pantry-browser'); if (queued !== null) process.exit(queued)
import assert from 'node:assert/strict'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { dev, fresh, freePort, rer, save } from './runtime.mjs'
import { desktop, errors, phone, session, snapshot } from './journey.mjs'

const evidence = resolve(process.env.PANTRY_EVIDENCE ?? '.cache/pantry-browser')
await mkdir(evidence, { recursive: true })
const roots = [], servers = []
let browser
try {
  const first = await fresh(); roots.push(first)
  process.chdir(first)
  await rer(first, ['install'])
  const port = await freePort()
  await rer(first, ['setup', '--owner-email', 'owner@dev.localhost', '--port', String(port), '--non-interactive'])
  await rer(first, ['check', '--profile', 'first-party'])
  const server = await dev(first, port); servers.push(server)
  browser = await chromium.launch({ headless: true })
  const journeys = { desktop: await desktop(browser, first, server.origin, evidence) }
  await phone(browser, first, server.origin, evidence)
  const owner = await session(browser, first, server.origin, 'owner', 1440)
  const before = await snapshot(owner.context, server.origin)
  const docId = before.documents.documents.find(d => d.name === 'brightline-inv-88.pdf').id
  const docBefore = Buffer.from(await (await owner.context.request.get(`${server.origin}/api/pantry/documents/${docId}`)).body())
  await owner.context.close()
  await server.close(); servers.pop()

  // Export, then restore into an independent installation with a different owner.
  await rer(first, ['export', '--output', 'exports/installation.rer'])
  await copyFile(join(first, 'exports/installation.rer'), join(evidence, 'installation.rer'))
  const second = await fresh(); roots.push(second)
  process.chdir(second)
  await rer(second, ['install'])
  const port2 = await freePort()
  await rer(second, ['setup', '--owner-email', 'restored@dev.localhost', '--port', String(port2), '--non-interactive'])
  await mkdir(join(second, 'exports'), { recursive: true })
  await copyFile(join(evidence, 'installation.rer'), join(second, 'exports/installation.rer'))
  await rer(second, ['import', '--input', 'exports/installation.rer', '--yes'])
  const restoredServer = await dev(second, port2); servers.push(restoredServer)
  const restored = await session(browser, second, restoredServer.origin, 'owner', 1440)
  const after = await snapshot(restored.context, restoredServer.origin)
  for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], `${key} is identical after restore`)
  const reversal = after.journal.entries.find(e => e.source_kind === 'reversal')
  assert.ok(reversal && after.journal.entries.find(e => e.id === reversal.reverses_id).reversed_by_id === reversal.id, 'reversal history survives restore')
  const docAfter = Buffer.from(await (await restored.context.request.get(`${restoredServer.origin}/api/pantry/documents/${docId}`)).body())
  assert.deepEqual(docAfter, docBefore, 'document bytes survive restore')
  assert.equal(after.close.status, 'locked')
  // The restored books keep working: October is open and the lock still holds September.
  const r = await restored.context.request.post(`${restoredServer.origin}/api/pantry/command/journal.save-draft`, { headers: { origin: restoredServer.origin }, data: { date: '2026-09-15', memo: 'x', lines: [{ accountId: after.trialBalance.rows[0].id, debit: '1.00' }, { accountId: after.trialBalance.rows[1].id, credit: '1.00' }] } })
  assert.equal(r.status(), 409)
  await restored.context.close()
  await restoredServer.close(); servers.pop()
  assert.deepEqual(errors, [], 'no browser errors')
  await save(evidence, 'result.json', { passed: true, journeys, restore: Object.keys(before), screenshots: (await import('node:fs')).readdirSync(evidence).filter(f => f.endsWith('.png')).sort() })
  console.log(`PANTRY_BROWSER_PROOF PASS — screenshots and archive in ${evidence}`)
} finally {
  await browser?.close()
  for (const s of servers) await s.close().catch(() => {})
  process.chdir(resolve(evidence, '..'))
  for (const root of roots) await rm(root, { recursive: true, force: true })
}
