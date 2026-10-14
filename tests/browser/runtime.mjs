// Real installations for the browser journey: a fresh clone of the committed
// checkout, driven only through the published `rer` verbs.
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const entry = fileURLToPath(import.meta.resolve('@runeditrun/rer/internal/global/rer.mjs'))
const source = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', RER_SERVER_JOURNEY: '1' }
const clean = s => s.replace(/^RER_OPEN .*$/gm, 'RER_OPEN [private sign-in URL omitted]').replace(/([?&#]token=|#key=)[^\s&]+/g, '$1[redacted]')

export async function fresh() {
  const root = await mkdtemp(join(tmpdir(), 'pantry-installation-'))
  await promisify(execFile)('git', ['clone', '--no-hardlinks', '--quiet', source, root])
  return root
}

export async function freePort() {
  const s = createServer()
  await new Promise(r => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise(r => s.close(r))
  return port
}

export async function rer(root, args, { expected = 0 } = {}) {
  const child = spawn(process.execPath, [entry, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', c => { log += c })
  const code = await new Promise((ok, fail) => { child.once('error', fail); child.once('close', ok) })
  if (code !== expected) throw new Error(`rer ${args[0]} exited ${code}:\n${clean(log).slice(-6000)}`)
  console.log(`rer ${args.join(' ')}: exit ${code}`)
  return clean(log)
}

export async function dev(root, port) {
  const child = spawn(process.execPath, [entry, 'dev', '--port', String(port), '--foreground'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', c => { output += c })
  const deadline = Date.now() + 15 * 60 * 1000
  while (!output.includes('RER_READY') && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev exited: ${clean(output).slice(-4000)}`)
    await new Promise(r => setTimeout(r, 250))
  }
  if (!output.includes('RER_READY')) { child.kill('SIGTERM'); throw new Error('dev readiness timed out') }
  return { origin: `http://127.0.0.1:${port}`, async close() { await rer(root, ['dev', '--stop']); if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) } } }
}

export async function save(dir, name, value) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
}
