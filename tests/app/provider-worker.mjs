// The emitted production Worker and assets, with only upstream provider HTTP
// faked at its network edge. Auth, SSR, commands and D1 are production code.
import { createServer } from 'node:net'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_getMiniflareWorkerOptions, unstable_splitSqlQuery } from 'wrangler'
import { TOKEN } from './worker.mjs'

export async function providerWorker({ bindings, outbound, clock = false }) {
  const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r))
  const port = socket.address().port; await new Promise(r => socket.close(r))
  const origin = `http://127.0.0.1:${port}`, dir = await mkdtemp(join(tmpdir(), 'pantry-provider-app-'))
  const options = unstable_getMiniflareWorkerOptions('dist/server/wrangler.json')
  const entry = clock ? { stdin: { contents: `import worker from ${JSON.stringify(options.main)}; import { fixtureTime } from './tests/clock.ts'; export default {...worker, fetch(request, env, ctx) { return fixtureTime(request, request => worker.fetch(request, env, ctx)) }};`, resolveDir: process.cwd(), sourcefile: 'fixture-clock-worker.ts' } } : { entryPoints: [options.main] }
  const bundle = await build({ ...entry, bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], target: 'es2023', logLevel: 'error' })
  const mf = new Miniflare({ ...convertV4MiniflareOptions({
    host: '127.0.0.1', port, modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: options.workerOptions.compatibilityDate, compatibilityFlags: options.workerOptions.compatibilityFlags,
    d1Databases: { DB: 'pantry' }, assets: { ...options.workerOptions.assets, binding: 'ASSETS' },
    bindings: { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'app-test-session-secret-0123456789abcdef', SETUP_TOKEN: TOKEN, MAIL_PROVIDER: 'development', MAIL_FROM: 'Pantry <pantry@example.test>', ...bindings },
    outboundService: outbound,
  }), resourcePersistencePath: dir })
  const close = async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }) }
  try {
    const db = await mf.getD1Database('DB')
    for (const file of (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort())
      await db.batch(unstable_splitSqlQuery(await readFile('migrations/core/' + file, 'utf8')).map(sql => db.prepare(sql)))
    await mf.ready
    return { origin, close }
  } catch (error) { await close(); throw error }
}
