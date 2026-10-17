// Back up a hosted Pantry: the whole hosted database (every table, and every receipt, bill PDF and
// statement file, which Pantry stores in it) as one SQL file in exports/, using the Cloudflare account
// ID and API token from the deploy file. `rer export` copies the books on this computer, not hosted ones.
//
//   rer queue hosted-backup -- node scripts/hosted-backup.mjs --env-file .env.pantry [--environment NAME] [--output FILE]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(dirname(new URL(import.meta.url).pathname), '..')
const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const fail = message => { console.error(message); process.exit(2) }

const envFile = flag('--env-file') ?? fail('Name the deploy file: --env-file .env.pantry')
const environment = flag('--environment') ?? 'production'
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(environment)) fail(`--environment ${environment} is not an environment name`)

let text
try { text = readFileSync(join(process.cwd(), envFile), 'utf8') } catch { fail(`The deploy file ${envFile} could not be read`) }
const values = Object.fromEntries(text.split(/\r?\n/).map(line => /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^(["'])(.*)\1$/, '$2')]))
for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) if (!values[key]) fail(`${envFile} has no ${key}; it is the file you deployed with`)

// rer deploy names the database after the project, the environment and the binding: pantry-production-db.
const declaration = JSON.parse(readFileSync(join(root, 'deploy.json'), 'utf8'))
const database = `${declaration.project.split('/').at(-1)}-${environment}-${declaration.d1[0].binding.toLowerCase().replaceAll('_', '-')}`
const output = flag('--output') ?? join('exports', `${database}-${new Date().toISOString().slice(0, 10)}.sql`)
mkdirSync(dirname(join(process.cwd(), output)), { recursive: true })

console.log(`Exporting ${database} from your Cloudflare account; the hosted Pantry pauses for the few seconds this takes.`)
const run = spawnSync(join(root, 'node_modules/.bin/wrangler'), ['d1', 'export', database, '--remote', '--output', output], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: values.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: values.CLOUDFLARE_API_TOKEN, WRANGLER_SEND_METRICS: 'false' },
})
if (run.status !== 0) {
  const said = `${run.stdout}\n${run.stderr}`.split('\n').filter(line => /error|not found|authentication|permission|\[ERROR\]/i.test(line)).slice(0, 6).join('\n')
  fail(`The export failed${said ? `:\n${said}` : ''}\nCheck the environment name (--environment) and that the API token has D1: Edit.`)
}

const sql = readFileSync(join(process.cwd(), output))
const rows = {}
for (const [, table] of sql.toString('utf8').matchAll(/^INSERT INTO "?([A-Za-z0-9_]+)"?/gm)) rows[table] = (rows[table] ?? 0) + 1
const count = name => rows[name] ?? 0
console.log(`Backed up ${database} to ${output} (${Math.round(statSync(join(process.cwd(), output)).size / 1024)} KB, sha256 ${createHash('sha256').update(sql).digest('hex')}).`)
console.log(`It holds ${Object.values(rows).reduce((s, n) => s + n, 0)} rows in ${Object.keys(rows).length} tables. Journal entries: ${count('pt_journal_entries')}, invoices: ${count('pt_invoices')}, bills: ${count('pt_bills')}, bank lines: ${count('pt_bank_lines')}, stored files: ${count('pt_documents')}.`)
