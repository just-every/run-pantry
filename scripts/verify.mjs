import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const sequence = ['build', 'typecheck', 'test:typecheck', 'test:pantry', 'test:site', 'test:runtime', 'test:app']
const pnpm = name => ['pnpm', ['run', name]]
export const shards = ['source', 'api-1', 'api-2', 'api-3', 'app-1', 'app-2', 'app-3']

export function verificationPlan(shard = process.env.VERIFY_SHARD ?? 'all') {
  // Keep the complete local command and its order. CI partitions only test files;
  // every new matching file automatically belongs to exactly one shard.
  if (shard === 'all') return sequence.map(pnpm)
  // Called through rer verify so its hosted-output and hydration checks still run.
  if (shard === 'source') return sequence.filter(name => !['test:pantry', 'test:app'].includes(name)).map(pnpm)
  const match = /^(api|app)-([1-3])$/.exec(shard)
  if (!match) throw new Error(`Unknown VERIFY_SHARD ${JSON.stringify(shard)}; choose ${shards.join(', ')}, or all`)
  const [, group, index] = match
  const files = readdirSync(resolve(root, 'tests', group)).filter(name => name.endsWith('.test.mjs')).sort()
    .filter((_, position) => position % 3 === Number(index) - 1).map(name => `tests/${group}/${name}`)
  if (!files.length) throw new Error(`Verification shard ${shard} has no test files`)
  const test = [process.execPath, ['--test', ...(group === 'api' ? ['--test-concurrency=1'] : []), ...files]]
  // Browser journeys exercise the real emitted Worker and assets, built in this job.
  return group === 'app' ? [pnpm('build'), test] : [test]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = verificationPlan()
  if (process.argv[2] === '--plan') console.log(JSON.stringify(plan, null, 2))
  else {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/verify.mjs [--plan]')
    for (const [command, args] of plan) {
      const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env })
      if (result.error) throw result.error
      if (result.status !== 0) process.exit(result.status ?? 1)
    }
  }
}
