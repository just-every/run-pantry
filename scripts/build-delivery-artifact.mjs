import { readFile, rm, rename, lstat } from 'node:fs/promises'
import { produceSeedArtifact } from './delivery/base/package.mjs'

// Base packages into a fresh directory. Publish its unchanged manifest and
// sibling payloads at the root required by the project import contract.
const config = JSON.parse(await readFile(new URL('../packaging.json', import.meta.url), 'utf8'))
const output = config.project.deployment.artifactFile
for (const path of ['delivery-artifact', 'payload', output]) {
  const stat = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (stat?.isSymbolicLink()) throw Error('Artifact output must not be a symlink')
  await rm(path, { recursive: true, force: true })
}
await produceSeedArtifact({ root: process.cwd(), config })
await rename('delivery-artifact/payload', 'payload')
await rename(`delivery-artifact/${output}`, output)
await rm('delivery-artifact', { recursive: true })
console.log(`Delivery artifact written to ${output}`)
