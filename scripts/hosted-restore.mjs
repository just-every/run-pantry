// Restore only into a reserved, fresh hosted destination. Keep its writers and
// Cron paused until the owner has compared restored books and document bytes.
import { readFile, lstat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPortability, PortabilityError } from '@runeditrun/rer/modules/portability'
import { fileRecords, importArchive } from '@runeditrun/rer/modules/portability/files'
import { migrationReplay } from '@runeditrun/rer/modules/portability/migration-history'
import { appliedMigrations } from '@runeditrun/rer/portability-migrations'
import { unstable_splitSqlQuery } from 'wrangler'
import policy from '../src/pantry/archive-policy.mjs'
import { hostedProvider, hostedDatabaseId, hostedD1 } from './hosted-d1.mjs'
import {hostedR2} from './hosted-r2.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fail = code => { throw new Error(code) }
const usage = 'node scripts/hosted-restore.mjs --input PRIVATE.rer --yes [--journal LATEST.rer] [--environment NAME] [--env-file PRIVATE_FILE]'

async function archiveInput(path) {
  if (typeof path !== 'string' || !path) fail('archive_input_required')
  const absolute = resolve(path), info = await lstat(absolute)
  if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077)) fail('archive_input_not_private')
  // Validate every checksum before any remote bookkeeping is created. The
  // importer validates again and authenticates its staged parts before apply.
  for await (const record of fileRecords(absolute)) { /* consume verified records */ }
  return absolute
}

/** Importable command entry for the native CLI and network-edge integration proof. */
export async function hostedRestore({ input, journal, yes = false, environment = 'production', env = process.env, envFile, fetch: request = globalThis.fetch } = {}) {
  if (yes !== true) fail('restore_confirmation_required')
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(environment)) fail('environment_invalid')
  if(envFile!==undefined){
    const info=await lstat(envFile)
    if(!info.isFile() || info.nlink!==1 || (info.mode&0o077))fail('deploy_input_not_private')
    const values=Object.fromEntries((await readFile(envFile,'utf8')).split(/\r?\n/)
      .map(line=>/^\s*(CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_API_TOKEN)\s*=\s*(.*?)\s*$/.exec(line))
      .filter(Boolean).map(([,key,value])=>[key,value.replace(/^(["'])(.*)\1$/,'$2')]))
    env={...env,...values}
  }
  const archive = await archiveInput(input)
  const later = journal === undefined ? undefined : await archiveInput(journal)
  const declaration = JSON.parse(await readFile(join(root, 'deploy.json'), 'utf8'))
  const binding = declaration.d1?.[0]?.binding
  if (typeof binding !== 'string' || !binding || typeof declaration.project !== 'string') fail('deployment_declaration_invalid')
  const name = `${declaration.project.split('/').at(-1)}-${environment}-${binding.toLowerCase().replaceAll('_', '-')}`
  const provider = hostedProvider({ accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN, fetch: request })
  const databaseId = await hostedDatabaseId(provider, name)
  const db = hostedD1(provider, databaseId)
  // Exact migration replay recognizes only unchanged bootstrap rows. It never
  // grants permission to replace arbitrary populated destination tables.
  const plan = await appliedMigrations(root, db, binding, {}, unstable_splitSqlQuery)
  const migrations = async () => migrationReplay(plan, policy)
  const bucketName=`${declaration.project.split('/').at(-1)}-${environment}-pantry-documents`
  const bucket=hostedR2({accountId:env.CLOUDFLARE_ACCOUNT_ID,token:env.CLOUDFLARE_API_TOKEN,bucketName,fetcher:request})
  const service = await createPortability({ db, policy, migrations, buckets:{PANTRY_DOCUMENTS:bucket} })
  const receipt = await importArchive(service, archive, ['local runtime caches and logs'], later)
  return { format: 'pantry-hosted-restore/1', database: name, ...receipt, erasureHistory: later ? 'later-journal-checked' : 'later-journal-not-supplied' }
}

export async function hostedRestoreCommand(args = process.argv.slice(2), options = {}) {
  if (args.length === 1 && args[0] === '--help') return { help: usage }
  const values = {}, seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (!['--input', '--journal', '--environment', '--env-file', '--yes'].includes(flag) || seen.has(flag)) fail('restore_arguments_invalid')
    seen.add(flag)
    if (flag === '--yes') values.yes = true
    else {
      const value = args[++index]
      if (!value || value.startsWith('--')) fail('restore_arguments_invalid')
      values[flag==='--env-file'?'envFile':flag.slice(2)] = value
    }
  }
  return hostedRestore({ ...options, ...values })
}

const publicCodes = new Set([
  'restore_confirmation_required', 'restore_arguments_invalid', 'environment_invalid',
  'archive_input_required', 'archive_input_not_private', 'deploy_input_not_private', 'deployment_declaration_invalid',
  'provider_credentials_required', 'provider_access_refused', 'provider_request_failed',
  'provider_response_invalid', 'provider_query_failed', 'provider_inventory_incomplete',
  'destination_database_not_unique', 'destination_database_invalid', 'unsupported_d1_parameter',
  'foreign_d1_statement', 'invalid_d1_statement',
])
export function hostedRestoreFailure(error) {
  if (error instanceof PortabilityError) {
    const code = error.code.split(':')[0]
    return /^[a-z_]+$/.test(code) ? code : 'archive_restore_refused'
  }
  if (publicCodes.has(error?.message)) return error.message
  return 'hosted_restore_failed'
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await hostedRestoreCommand()
    console.log(receipt.help ?? JSON.stringify(receipt))
  } catch (error) {
    console.error(`Hosted restore refused (${hostedRestoreFailure(error)}). Keep the archive and inspect the destination before retrying.`)
    process.exitCode = 2
  }
}
