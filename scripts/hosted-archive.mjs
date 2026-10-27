// Convert an owner-provided Cloudflare D1 export in an isolated disposable SQLite database.
// The ordinary Pantry policy and Base archive writer retain the erasure fence,
// scrub credentials and produce exactly the format consumed by rer import.
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { sqliteD1 } from './hosted-sqlite.mjs'
import { unstable_splitSqlQuery } from 'wrangler'
import { createPortability } from '@runeditrun/rer/modules/portability'
import { exportArchive } from '@runeditrun/rer/modules/portability/files'
import policy from './installer/portability.mjs'
import { checkedDocumentArchive } from '../src/pantry/document-archive.mjs'
import { hostedR2 } from './hosted-r2.mjs'

export async function hostedArchive({ input, output, buckets }) {
  const directory = await mkdtemp(join(tmpdir(), 'pantry-hosted-archive-'))
  let database
  try {
    database = new DatabaseSync(join(directory,'snapshot.sqlite'),{allowExtension:false})
    database.exec('PRAGMA foreign_keys=ON; BEGIN')
    const tables=[], indexes=[], views=[], rows=[], triggers=[]
    for(const sql of unstable_splitSqlQuery(await readFile(input,'utf8'))) {
      const command=sql.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/,'')
      // This is a D1 dump reader, not a general SQLite shell. In particular,
      // never allow ATTACH, VACUUM INTO, writable_schema or extension loading.
      if(!/^(?:CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)\b|INSERT\s+INTO\b|DELETE\s+FROM\s+["\`]?sqlite_sequence\b|PRAGMA\s+(?:defer_foreign_keys|foreign_keys)\s*=\s*(?:TRUE|FALSE|ON|OFF|0|1)\s*;?\s*$)/i.test(command))
        throw new Error('unsupported_snapshot_statement')
      if(/^CREATE\s+TABLE\b/i.test(command))tables.push(sql)
      else if(/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(command))indexes.push(sql)
      else if(/^CREATE\s+VIEW\b/i.test(command))views.push(sql)
      else if(/^CREATE\s+TRIGGER\b/i.test(command))triggers.push(sql)
      else if(!/^PRAGMA\b/i.test(command))rows.push(sql)
    }
    // D1 dumps interleave each table with its rows. Deferred foreign keys
    // still need their referenced tables to exist at insert time. Build the
    // complete schema first, then load its frozen rows, then restore triggers
    // so immutable-posting guards do not replay historical business actions.
    for(const sql of [...tables,...indexes,...views])database.exec(sql)
    database.exec('PRAGMA defer_foreign_keys=ON')
    for(const sql of rows)database.exec(sql)
    database.exec('COMMIT')
    for(const sql of triggers)database.exec(sql)
    if(database.prepare('PRAGMA foreign_key_check').all().length)throw new Error('snapshot_foreign_keys')
    const db=sqliteD1(database)
    // A restored SQL dump must retain the source-bound journal. A new identity
    // would make later erasure archives unable to fence this backup.
    const identity = await db.prepare('SELECT source_identity FROM rer_portability_state WHERE id=1').first()
    if (!identity?.source_identity) throw new Error('source_erasure_identity_missing')
    const service = await createPortability({ db, policy, buckets })
    const checked = {...service,exports:{...service.exports,download:id=>checkedDocumentArchive(db,service,id)}}
    return await exportArchive(checked, output, ['local runtime caches and logs'])
  } finally {
    database?.close()
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = name => args[args.indexOf(name) + 1]
  if (!args.includes('--input-sql') || !args.includes('--output') || args.length !== 6 || (!args.includes('--local-documents') && !args.includes('--bucket'))) {
    console.error('usage: node scripts/hosted-archive.mjs --input-sql FILE --output NEW.rer (--local-documents CHECKOUT | --bucket NAME)')
    process.exitCode = 2
  } else {
    let proxy
    const previousLog = process.env.WRANGLER_LOG
    process.env.WRANGLER_LOG = 'warn'
    try {
      let bucket
      if (args.includes('--local-documents')) {
        const root = resolve(flag('--local-documents')), {getPlatformProxy} = await import('wrangler')
        proxy = await getPlatformProxy({configPath:join(root,'wrangler.jsonc'),persist:{path:join(root,'.wrangler/state/v3')},remoteBindings:false})
        bucket = proxy.env.PANTRY_DOCUMENTS
      } else bucket = hostedR2({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,bucketName:flag('--bucket')})
      const receipt = await hostedArchive({ input: flag('--input-sql'), output: flag('--output'), buckets:{PANTRY_DOCUMENTS:bucket} })
      console.log(JSON.stringify({ format: 'pantry-hosted-backup/1', ...receipt }))
    } catch (error) {
      // Native SQL errors can include private row values; report only a code.
      console.error('Hosted archive failed (' + (error.code === 'EEXIST' ? 'output_exists' : ['unsupported_snapshot_statement','source_erasure_identity_missing','snapshot_foreign_keys'].includes(error.message) ? error.message : /^[A-Za-z_]+$/.test(error.code ?? '') ? error.code : 'snapshot_invalid') + '); original SQL was retained. No archive was published.')
      process.exitCode = 2
    } finally {
      await proxy?.dispose()
      if (previousLog === undefined) delete process.env.WRANGLER_LOG
      else process.env.WRANGLER_LOG = previousLog
    }
  }
}
