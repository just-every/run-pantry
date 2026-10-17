import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { operatorInstaller, developmentTarget, previewTarget } from '@runeditrun/rer/operator-installer';
import { selectLocalState } from '@runeditrun/rer/local/state';
import { commandAdapter as createCommandAdapter } from '@runeditrun/rer/adapter';
import { ownerDeploy } from '@runeditrun/rer/deploy';
import { localPortability } from '@runeditrun/rer/portability';
import * as model from './ui/seed.mjs';

export { selectLocalState };

// rer's refusal of a restore into a folder that already holds books names only its code; say what
// it means for these books and the next step. Nothing is changed by a refused restore.
const portability = localPortability({ database: 'foundation', policyModule: 'scripts/installer/portability.mjs', transient: ['local runtime caches and logs'] });
const NOT_EMPTY = 'Restore refused (target_not_empty): this folder already holds Pantry books, and a restore only goes into an empty installation. Nothing was changed.\n'
 + 'To replace these books with the archive, run: rer dev --stop; rer export --output exports/books-before-restore.rer (to keep a copy of them); rer reset --yes; rer import --input <your archive> --yes; rer setup --owner-email <you>.\n'
 + 'To keep both, restore into a fresh clone of Pantry instead. Steps: https://run-pantry.com/docs/backup';
const explainedPortability = { ...portability, async import(context) {
 try { return await portability.import(context); }
 catch (error) { if (/\(target_not_empty\b/.test(error?.message ?? '')) error.message = NOT_EMPTY; throw error; }
} };
const lifecycle = operatorInstaller({
 database: 'foundation', features: model.features,
 async prepare({ root, input, store }) {
  // export and import run prepare without answers; the saved branding stays.
  if (input.APP_NAME === undefined && input.PRIMARY_COLOR === undefined) return;
  await store.step('Saving application branding');
  await writeFile(join(root, 'src/branding.json'), JSON.stringify({ name: input.APP_NAME, primaryColor: input.PRIMARY_COLOR }, null, 2) + '\n');
 },
});
export const adapter = lifecycle;
export const { install } = lifecycle;
export const commandAdapter = createCommandAdapter(lifecycle, {
 dev: developmentTarget, preview: previewTarget, verify: ['pnpm', ['run', 'verify:app']], deploy: ownerDeploy('deploy.json', lifecycle),
 portability: explainedPortability,
 setup: { manifestFile: 'rer-setup.json' }, browserModule: 'scripts/installer/ui/seed.mjs',
 // The run site (rer build --site, rer deploy --site, RER_SITE): pages from
 // edition identity and Run data, written to an ignored folder; its domain is in deploy-site.json.
 site: { entry: 'src/site/pages.tsx', output: 'dist/site', declaration: 'deploy-site.json', config: 'vite.site.config.ts' },
 // Local dev identity: the local-only Worker entry, the build output rer build
 // scans for the dev layer.
 devIdentity: { entry: 'src/server.dev.ts', output: ['dist'] },
 localOnlyKeys: ['RER_DEV_ORIGIN', 'RER_DEV_IDENTITY'],
 product: model.product.name, input: { names: { email: 'OWNER_EMAIL', name: 'displayName' }, async defaults(root) { const { readFile } = await import('node:fs/promises'); const branding = JSON.parse(await readFile(join(root, 'src/branding.json'), 'utf8')); return { APP_NAME: branding.name, PRIMARY_COLOR: branding.primaryColor }; } },
});
