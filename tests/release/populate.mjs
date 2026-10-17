// Run in the previous release's checkout (cwd), with TMPDIR an empty directory:
// Juniper Lane's September built through that release's own API harness and
// scenario (statements imported, every line matched and reconciled, documents,
// an accountant, a reversal, the month locked). Saves what the owner saw and
// the persisted D1 to OUT for upgrade.test.mjs.
// usage: node <current>/tests/release/populate.mjs OUT
import { cp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = process.cwd(), out = process.argv[2]
const { harness } = await import(join(repo, 'tests/api/harness.mjs'))
const { september, importStatements, matchSeptember, closeReady } = await import(join(repo, 'tests/api/scenario.mjs'))

const h = await harness()
try {
  const s = await september(h)
  const st = await importStatements(h, s)
  await matchSeptember(h, s, st)
  await closeReady(h, s, st)
  const accountant = await h.member('ann@example.test', 'accountant', { canPost: true, canLock: true, canReopen: true })
  const fix = await h.command('journal.save-draft', { date: '2026-09-29', memo: 'Equipment', lines: [{ accountId: s.acct['1500'], debit: '300.00' }, { accountId: s.acct['3000'], credit: '300.00' }] })
  const posted = await h.command('journal.post', { id: fix.id, revision: fix.revision })
  await h.command('journal.reverse', { id: posted.id, date: '2026-09-30', memo: 'Belonged to October' })
  await h.command('period.lock', { period: '2026-09' })

  const views = {}
  for (const path of ['reports/trial-balance?to=2026-09-30', 'reports/profit-and-loss?from=2026-09-01&to=2026-09-30', 'reports/balance-sheet?to=2026-09-30', 'journal', `reconciliation/${st.checking.id}`, `reconciliation/${st.savings.id}`, 'close/2026-09', 'documents'])
    views[path] = await h.view(path)
  const documents = (await h.db.prepare('SELECT id, name, sha256 FROM pt_documents ORDER BY name').all()).results
  const tables = (await h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r => r.name)
  const counts = {}
  for (const t of tables) counts[t] = (await h.db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).first()).n
  const migrations = (await readdir('migrations/core')).filter(f => f.endsWith('.sql')).sort()
  await writeFile(join(out, 'before.json'), JSON.stringify({ origin: h.origin, owner: h.owner, accountant, statements: { checking: st.checking.id, savings: st.savings.id }, migrations, views, documents, counts }, null, 1), { mode: 0o600 })

  // The harness persists its D1 under TMPDIR; copy it while the Worker still holds it, every write settled.
  const dirs = (await readdir(tmpdir())).filter(d => d.startsWith('pantry-test-'))
  if (dirs.length !== 1) throw Error(`expected one harness directory under ${tmpdir()}, found ${dirs.length}`)
  await new Promise(r => setTimeout(r, 500))
  await cp(join(tmpdir(), dirs[0]), join(out, 'persist'), { recursive: true })
  console.log(JSON.stringify({ previousMigrations: migrations.length, entries: counts.pt_journal_entries, bankLines: counts.pt_bank_lines, matchedLines: counts.pt_match_bank_lines, documents: counts.pt_documents }))
} finally {
  await h.close()
}
