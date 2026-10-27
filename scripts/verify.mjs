import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const sequence = ['contract:check', 'build', 'typecheck', 'test:pantry', 'test:runtime', 'test:app']
const pnpm = name => ['pnpm', ['run', name]]
// Only CI browser consumers opt into the source job's build. Local verification
// and the source job keep their original build-first sequence.
const prebuilt = process.env.CI === 'true' && process.env.VERIFY_PREBUILT === 'true'
const browserPlan = test => prebuilt ? [test] : [pnpm('build'), test]
export const shards = ['source', 'api-1', 'api-2', 'api-3', 'api-4', 'api-5', 'app-1', 'app-2', 'app-3', 'app-4', 'app-5', 'app-6', 'app-7', 'app-8']

export function verificationPlan(shard = process.env.VERIFY_SHARD ?? 'all') {
  // Keep the complete local command and its order. CI partitions only test files;
  // every new matching file automatically belongs to exactly one shard.
  if (shard === 'all') return sequence.map(pnpm)
  // Called through rer verify so its hosted-output and hydration checks still run.
  if (shard === 'source') return sequence.filter(name => !['test:pantry', 'test:app'].includes(name)).map(pnpm)
  const match = /^(api|app)-([1-8])$/.exec(shard)
  if (!match) throw new Error(`Unknown VERIFY_SHARD ${JSON.stringify(shard)}; choose ${shards.join(', ')}, or all`)
  const [, group, index] = match
  const part = Number(index)
  if (group === 'api' && part > 5) throw new Error(`Unknown API shard ${shard}`)
  // Keep import and report suites as dedicated logical partitions.
  // The other files divide across three more partitions, including new files.
  const dedicatedApi=['move-in.test.mjs','reports.test.mjs']
  if(group==='api'&&part<=2)return [[process.execPath,['--test','--test-concurrency=1',`tests/api/${dedicatedApi[part-1]}`]]]
  // app.test.mjs contains many independent, sequential public-door journeys.
  // File-only modulo sharding left all of them on app-1 (over 14 minutes).
  // Partition its top-level registrations without moving evidence paths or
  // changing any assertion; other browser files get three separate jobs.
  if (group === 'app' && part <= 5) {
    const source = readFileSync(resolve(root, 'tests/app/app.test.mjs'), 'utf8')
    const names = [...source.matchAll(/^test\('([^'\n]+)'[,)]/gm)].map(match => match[1])
    const registrations = [...source.matchAll(/^test\(/gm)].length
    if (!names.length || names.length !== registrations) throw new Error('Every app.test.mjs registration needs a literal name for CI partitioning')
    const selected = names.filter((_, position) => position % 5 === part - 1)
    const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = `^(?:${selected.map(escape).join('|')})(?:$| )`
    return browserPlan([process.execPath, ['--test', `--test-name-pattern=${pattern}`, 'tests/app/app.test.mjs']])
  }
  const files = readdirSync(resolve(root, 'tests', group)).filter(name => name.endsWith('.test.mjs')).sort()
    .filter(name => group === 'app' ? name !== 'app.test.mjs' : !dedicatedApi.includes(name))
    .filter((_, position) => position % 3 === (group === 'app' ? part - 6 : part - 3)).map(name => `tests/${group}/${name}`)
  if (!files.length) throw new Error(`Verification shard ${shard} has no test files`)
  // Separate Miniflare processes reserve then release an ephemeral port before
  // startup. Serialize files within each job so their proxy startups cannot
  // race one another; the independent jobs still run in parallel.
  const test = [process.execPath, ['--test', '--test-concurrency=1', ...files]]
  // Browser journeys exercise the real emitted Worker and assets, shared by CI.
  return group === 'app' ? browserPlan(test) : [test]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = verificationPlan()
  if (process.argv[2] === '--plan') console.log(JSON.stringify(plan, null, 2))
  else {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/verify.mjs [--plan]')
    if (prebuilt && process.env.VERIFY_SHARD?.startsWith('app-')) {
      if (!statSync(resolve(root, 'dist/server/wrangler.json')).isFile() || !statSync(resolve(root, 'dist/client')).isDirectory()) {
        throw new Error('CI browser verification requires the shared source build')
      }
    }
    for (const [command, args] of plan) {
      const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
      if (result.error) throw result.error
      if (result.status !== 0) process.exit(result.status ?? 1)
    }
  }
}
