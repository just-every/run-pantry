import '../browser-home.mjs'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TOKEN = 'synthetic-app-test-setup-token-0123456789abcdef'
const wrangler = ['node_modules/wrangler/bin/wrangler.js']
const quiet = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }

async function freePort() {
  const s = createServer()
  await new Promise(r => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise(r => s.close(r))
  return port
}

/** The emitted Worker on 127.0.0.1 with a local owner; resolves once /health answers. */
export async function worker() {
  const port = await freePort(), origin = `http://127.0.0.1:${port}`, persist = await mkdtemp(join(tmpdir(), 'pantry-app-'))
  execFileSync(process.execPath, [...wrangler, 'd1', 'migrations', 'apply', 'foundation', '--local', '--persist-to', persist, '--config', 'dist/server/wrangler.json'], { stdio: 'pipe', maxBuffer: 8 * 1024 * 1024, env: quiet })
  const vars = { AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', OWNER_EMAIL: 'owner@example.test', SESSION_SECRET: 'app-test-session-secret-0123456789abcdef', SETUP_TOKEN: TOKEN, MAIL_PROVIDER: 'development', MAIL_FROM: 'Pantry <pantry@example.test>' }
  const child = spawn(process.execPath, [...wrangler, 'dev', '--inspector-port', '0', '--local', '--persist-to', persist, '--ip', '127.0.0.1', '--port', String(port), '--config', 'dist/server/wrangler.json', ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { stdio: ['ignore', 'pipe', 'pipe'], env: quiet })
  let output = ''
  child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(output)
    try { if ((await fetch(`${origin}/health`)).ok) break } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  return { origin, logs: () => output, async close() { child.kill('SIGTERM'); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); await rm(persist, { recursive: true, force: true }) } }
}

