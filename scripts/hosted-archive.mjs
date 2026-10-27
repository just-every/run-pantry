// Convert an owner-provided Cloudflare D1 export in an isolated disposable D1.
// The ordinary Pantry policy and Base archive writer retain the erasure fence,
// scrub credentials and produce exactly the format consumed by rer import.
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { createPortability } from '@runeditrun/rer/modules/portability'
import { exportArchive } from '@runeditrun/rer/modules/portability/files'
import policy from './installer/portability.mjs'

export async function hostedArchive({ input, output }) {
  const directory = await mkdtemp(join(tmpdir(), 'pantry-hosted-archive-'))
  let mf
  try {
    mf = new Miniflare({ ...convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response(null,{status:404})}}',
      compatibilityDate: '2026-09-08', d1Databases: { DB: 'snapshot' } }), resourcePersistencePath: directory })
    const db = await mf.getD1Database('DB')
    const statements = unstable_splitSqlQuery(await readFile(input, 'utf8'))
    // One atomic import also honours the deferred foreign keys in D1 exports.
    await db.batch(statements.map(sql => db.prepare(sql)))
    // A restored SQL dump must retain the source-bound journal. A new identity
    // would make later erasure archives unable to fence this backup.
    const identity = await db.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first()
    if (!identity?.source_identity) throw new Error('source_erasure_identity_missing')
    const service = await createPortability({ db, policy })
    return await exportArchive(service, output, ['local runtime caches and logs'])
  } finally {
    await mf?.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2), flag = name => args[args.indexOf(name) + 1]
  if (!args.includes('--input-sql') || !args.includes('--output') || args.length !== 4) {
    console.error('usage: node scripts/hosted-archive.mjs --input-sql FILE --output NEW.rer')
    process.exitCode = 2
  } else {
    try {
      const receipt = await hostedArchive({ input: flag('--input-sql'), output: flag('--output') })
      console.log(JSON.stringify({ format: 'pantry-hosted-backup/1', ...receipt }))
    } catch (error) {
      // Native SQL errors can include private row values; report only a code.
      console.error('Hosted archive failed (' + (error.code === 'EEXIST' ? 'output_exists' : /^[a-z_]+$/.test(error.code ?? '') ? error.code : 'snapshot_invalid') + '); original SQL was retained. No archive was published.')
      process.exitCode = 2
    }
  }
}
