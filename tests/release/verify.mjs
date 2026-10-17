// Release verification, apart from push Verify: a book made on the previous
// release tag upgrades to this checkout (upgrade.test.mjs).
// usage: node tests/release/verify.mjs [--from vX.Y.Z] [--evidence DIRECTORY]
import { spawn } from 'node:child_process'

const args = process.argv.slice(2), env = { ...process.env }
for (let i = 0; i < args.length; i += 2) {
  if (!['--from', '--evidence'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node tests/release/verify.mjs [--from vX.Y.Z] [--evidence DIRECTORY]')
  env[args[i] === '--from' ? 'PANTRY_UPGRADE_FROM' : 'PANTRY_UPGRADE_EVIDENCE'] = args[i + 1]
}
spawn(process.execPath, ['--test', 'tests/release/upgrade.test.mjs'], { env, stdio: 'inherit' })
  .on('exit', code => { process.exitCode = code ?? 1 })
