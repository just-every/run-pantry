import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {deploymentSpec} from './delivery/base/spec.mjs';

const check = process.argv[2] === '--check';
if (process.argv.length > (check ? 3 : 2)) throw Error('Use --check or no arguments');
const config = JSON.parse(await readFile('packaging.json', 'utf8'));
const spec = await deploymentSpec(process.cwd(), config.artifact.specInputs);
const bytes = `${JSON.stringify(spec, null, 2)}\n`;
const path = 'management/integration/deployment-spec.json';
if (check) {
 if (await readFile(path, 'utf8') !== bytes) throw Error('Deployment specification is stale; build Pantry and run pnpm delivery:spec, then commit the specification.');
 console.log('Deployment specification matches the real build and source policy.');
} else {
 await mkdir('management/integration', {recursive: true});
 await writeFile(path, bytes);
 console.log(`Wrote ${path} with ${spec.migrations.length} unchanged migrations.`);
}
