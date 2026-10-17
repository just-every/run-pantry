// A book made on the previous release upgrades to this checkout. The previous
// tag's own harness builds a September with matched and reconciled bank lines
// (populate.mjs); this checkout's wrangler applies the pending migrations the way
// `rer dev` does; this checkout's Worker then reads the same books on the same
// D1 with the old sessions. Runs on release tags and nightly (release.yml).
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readUpgraded } from './compare.mjs'

const root = process.cwd()
const evidence = process.env.PANTRY_UPGRADE_EVIDENCE ? resolve(process.env.PANTRY_UPGRADE_EVIDENCE) : null

function run(cwd, command, args, log, env = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const file = createWriteStream(log, { flags: 'a' }), text = []
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { file.write(chunk); text.push(chunk) })
    child.on('error', fail)
    child.on('close', code => file.end(() => {
      const output = Buffer.concat(text).toString()
      code === 0 ? done(output) : fail(Object.assign(new Error(`${command} ${args.join(' ')} exited ${code} (${log}):\n${output.slice(-4000)}`), { output }))
    }))
  })
}
const git = async (...args) => (await run(root, 'git', args, '/dev/null')).trim()

/** The newest release tag behind HEAD that is not HEAD's own. */
async function previousTag() {
  const own = new Set((await git('tag', '--points-at', 'HEAD')).split('\n'))
  const tag = (await git('tag', '--list', 'v*', '--merged', 'HEAD', '--sort=-v:refname')).split('\n').find(t => t && !own.has(t))
  assert.ok(tag, 'no previous release tag: fetch tags (fetch-depth 0) or pass --from')
  return tag
}

test('a book with matched bank lines made on the previous release upgrades in place and reads the same', { timeout: 1500000 }, async () => {
  const previous = process.env.PANTRY_UPGRADE_FROM ?? await previousTag()
  if (evidence) await mkdir(evidence, { recursive: true })
  const dir = await mkdtemp(join(evidence ?? tmpdir(), '.release-upgrade-'))
  const old = join(dir, 'previous'), state = join(dir, 'state'), scratch = join(dir, 'tmp')
  let ok = false
  try {
    const sha = await git('rev-parse', `${previous}^{commit}`)
    await run(root, 'git', ['clone', '--quiet', '--shared', '--no-checkout', root, old], join(dir, 'clone.log'))
    await run(old, 'git', ['checkout', '--quiet', '--detach', sha], join(dir, 'clone.log'))
    await run(old, 'pnpm', ['install', '--frozen-lockfile'], join(dir, 'previous-install.log'))
    await mkdir(scratch)
    console.log(await run(old, process.execPath, [join(root, 'tests/release/populate.mjs'), dir], join(dir, 'populate.log'), { TMPDIR: scratch }))
    const before = JSON.parse(await readFile(join(dir, 'before.json'), 'utf8'))
    assert.ok(before.counts.pt_match_bank_lines > 0, 'the previous release book has matched bank lines')

    // The D1 as `rer dev` keeps it: wrangler's local state, its ledger naming every migration the previous release applied.
    await cp(join(dir, 'persist'), join(state, 'v3'), { recursive: true })
    const config = join(dir, 'wrangler.json')
    await writeFile(config, JSON.stringify({ name: 'pantry-upgrade', compatibility_date: '2026-09-08', d1_databases: [{ binding: 'DB', database_name: 'pantry', database_id: 'pantry', migrations_dir: join(root, 'migrations/core') }] }))
    const local = ['--local', '--persist-to', state, '--config', config]
    const ledger = "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);" + before.migrations.map(name => `INSERT INTO d1_migrations (name) VALUES ('${name}');`).join('')
    await run(root, 'pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', ...local, '--command', ledger], join(dir, 'ledger.log'))
    await run(root, 'pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', ...local], join(dir, 'upgrade.log'))
    const files = (await readdir(join(state, 'v3/d1/miniflare-D1DatabaseObject'))).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    assert.equal(files.length, 1, 'wrangler upgraded the previous release book, not a new database')

    const after = { previous, sha, ...await readUpgraded(root, join(state, 'v3'), before) }
    await writeFile(join(dir, 'after.json'), JSON.stringify(after, null, 1))
    console.log(JSON.stringify({ ...after, counts: `${Object.keys(after.counts).length} tables, every count the same` }, null, 1))
    ok = true
  } finally {
    // The previous checkout comes back from its tag; the books, logs and state stay as evidence or for diagnosis.
    await rm(old, { recursive: true, force: true })
    if (ok && !evidence) await rm(dir, { recursive: true, force: true })
    else if (!ok) console.log(`kept for diagnosis: ${dir}`)
  }
})
