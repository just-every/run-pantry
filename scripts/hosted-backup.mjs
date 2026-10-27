// Owner-run hosted backup, suitable for an unattended owner-controlled scheduler.
// Credentials are read from the private deploy file or injected environment.
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, lstatSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { hostedR2 } from './hosted-r2.mjs'
import { hostedArchive } from './hosted-archive.mjs'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const fail = message => { console.error(message); process.exit(2) }
if (args.length === 1 && args[0] === '--help') {
  console.log('usage: node scripts/hosted-backup.mjs [--env-file PRIVATE_FILE] [--environment NAME] [--output NEW.rer]'); process.exit(0)
}
const environment = flag('--environment') ?? 'production'
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(environment)) fail('Choose a valid environment name')
const envFile = flag('--env-file')
let values = {}
if (envFile) {
  try {
    const path = resolve(envFile), info = statSync(path)
    if (!info.isFile() || (info.mode & 0o077)) fail('The deploy file must be a private file (chmod 600)')
    values = Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).map(line => /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^(["'])(.*)\1$/, '$2')]))
  } catch { fail('The private deploy file could not be read') }
}
const declaration = JSON.parse(readFileSync(join(root, 'deploy.json'), 'utf8'))
const database = `${declaration.project.split('/').at(-1)}-${environment}-${declaration.d1[0].binding.toLowerCase().replaceAll('_', '-')}`
const output = resolve(flag('--output') ?? join('exports', `${database}-${new Date().toISOString().replaceAll(':', '-')}.rer`))
// Refuse an occupied destination before any provider call or database pause.
if (lstatSync(output, {throwIfNoEntry:false})) fail('Output already exists; choose a new archive path. No provider request was made.')
for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) if (!(values[key] ?? process.env[key])) fail('Supply the Cloudflare account and D1 token through the private deploy file or environment')
process.umask(0o077)
const directory = mkdtempSync(join(tmpdir(), 'pantry-hosted-backup-')), sql = join(directory, 'snapshot.sql')
try {
  // Establish one durable source identity before its first snapshot. Repeated
  // backups retain it; erasure and later-journal checks rely on that identity.
  const identity = spawnSync(join(root, 'node_modules/.bin/wrangler'), ['d1', 'execute', database, '--remote', '--command',
    "INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,'" + randomUUID() + "')"], {
    cwd: root, stdio: ['ignore','pipe','pipe'], timeout: 60_000,
    env: {...process.env, CLOUDFLARE_ACCOUNT_ID: values.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: values.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN, WRANGLER_SEND_METRICS:'false'},
  })
  if (identity.status !== 0) throw new Error('provider_export_failed')
  const run = spawnSync(join(root, 'node_modules/.bin/wrangler'), ['d1', 'export', database, '--remote', '--output', sql], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: values.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: values.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN, WRANGLER_SEND_METRICS: 'false' },
  })
  if (run.status !== 0) throw new Error('provider_export_failed')
  chmodSync(sql, 0o600)
  const bucketName = `${declaration.project.split('/').at(-1)}-${environment}-pantry-documents`
  const bucket = hostedR2({accountId:values.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID,token:values.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN,bucketName})
  const receipt = await hostedArchive({ input: sql, output, buckets:{PANTRY_DOCUMENTS:bucket} })
  console.log(JSON.stringify({ format: 'pantry-hosted-backup/1', database, output, bytes: statSync(output).size, ...receipt }))
} catch (error) {
  // Preserve a completed SQL export if conversion fails. Never echo provider
  // diagnostics: they can include a token, a signed URL or private SQL.
  if (error.message !== 'provider_export_failed') {
    console.error(`Hosted archive conversion failed; the private SQL is retained at ${sql}. Run scripts/hosted-archive.mjs against it after repairing the cause.`)
    process.exitCode = 2
  } else {
    rmSync(directory, { recursive: true, force: true })
    console.error('Hosted export failed; check the named environment and D1 permission. No backup was published.')
    process.exitCode = 2
  }
}
if (!process.exitCode) rmSync(directory, { recursive: true, force: true })
