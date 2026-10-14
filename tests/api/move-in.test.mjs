import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { at, fixture, harness } from './harness.mjs'

const FILES = { accounts: 'account-list.csv', customers: 'customer-contact-list.csv', vendors: 'vendor-contact-list.csv', trialBalance: 'trial-balance.csv', openInvoices: 'open-invoices.csv', unpaidBills: 'unpaid-bills.csv', generalLedger: 'general-ledger.csv' }
async function cutoverPackage(overrides = {}) {
  const files = {}
  for (const [key, name] of Object.entries(FILES)) files[key] = { name, content: overrides[key] ?? await fixture(`quickbooks-online/${name}`) }
  return { files, banks: [{ account: 'Operating Checking', institution: 'Chase', last4: '4821', statementBalance: overrides.balance ?? '24813.52' }] }
}
const count = async (h, table) => Number((await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n)

test('PAN-16 a QuickBooks Online cutover is previewed, imported as staged records, undone or signed off by the accountant', async t => {
  const h = await harness(); t.after(() => h.close())
  await h.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-09-01' })
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true })
  const pkg = await cutoverPackage()
  // Dry run: counts, tie-outs and missing documents, and nothing written.
  const preview = await h.command('move-in.preview', pkg, bea)
  assert.equal(preview.cutoverDate, '2026-08-31')
  assert.deepEqual(Object.fromEntries(Object.entries(preview.counts).map(([k, v]) => [k, v.accepted])), { accounts: 17, customers: 3, vendors: 3, bankAccounts: 1, trialBalance: 13, openInvoices: 2, unpaidBills: 2, historyLines: 6 })
  assert.ok(preview.checks.every(c => c.ok), JSON.stringify(preview.checks.filter(c => !c.ok)))
  assert.equal(preview.refused.length, 0); assert.match(preview.missingDocuments, /4 open invoices and bills/)
  assert.equal(await count(h, 'pt_accounts') + await count(h, 'ik_jobs'), 0)
  // Tie-outs that fail and rows that cannot map stop the import.
  const off = await h.command('move-in.preview', await cutoverPackage({ balance: '24800.00' }), bea)
  assert.equal(at(off.checks, c => c.key === 'bank:Operating Checking').ok, false)
  await h.command('move-in.commit', { ...(await cutoverPackage({ balance: '24800.00' })), fingerprint: off.fingerprint }, bea, 409)
  const broken = (await fixture('quickbooks-online/trial-balance.csv')).replace('Professional Fees,508.79,', 'Legal Fees,508.79,')
  const refused = await h.command('move-in.preview', await cutoverPackage({ trialBalance: broken }), bea)
  assert.deepEqual(refused.refused.map(r => [r.kind, r.reason]), [['trial-balance', 'Trial balance account "Legal Fees" is not in the Account List']])
  assert.equal(at(refused.checks, c => c.key === 'tb').ok, false)
  // A preview that no longer matches the files is not imported.
  await h.command('move-in.commit', { ...pkg, fingerprint: refused.fingerprint }, bea, 409)
  // Commit: staged records, the opening balances as a draft, the history kept read-only.
  const { job } = await h.command('move-in.commit', { ...pkg, fingerprint: (await h.command('move-in.preview', pkg, ann)).fingerprint }, ann)
  assert.equal(job.state, 'completed')
  assert.deepEqual([await count(h, 'pt_accounts'), await count(h, 'pt_contacts'), await count(h, 'pt_bank_accounts'), await count(h, 'pt_invoices'), await count(h, 'pt_bills'), await count(h, 'pt_history_lines')], [17, 6, 1, 2, 2, 6])
  assert.equal((await h.view('reports/trial-balance?to=2026-08-31')).rows.length, 0, 'nothing posts before sign-off')
  const original = await h.db.prepare("SELECT sha256 FROM ik_originals WHERE job_id = ? AND name = 'trial-balance.csv'").bind(job.id).first()
  assert.equal(original.sha256, createHash('sha256').update(pkg.files.trialBalance.content).digest('hex'), 'the uploaded export is kept byte for byte')
  // The accountant who imported the opening balances does not sign them off.
  const first = at((await h.view('move-in')).cutovers, c => c.status === 'staged')
  await h.command('move-in.accept', { id: first.id, revision: first.revision }, ann, 403)
  // Undo removes every staged record.
  await h.command('move-in.undo', { jobId: job.id }, bea, 403)
  await h.command('move-in.undo', { jobId: job.id }, ann)
  assert.deepEqual([await count(h, 'pt_accounts'), await count(h, 'pt_contacts'), await count(h, 'pt_journal_entries'), await count(h, 'pt_history_lines'), await count(h, 'pt_cutovers')], [0, 0, 0, 0, 0])
  // Import again and sign off: the opening balances post and tie out.
  const again = await h.command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint }, bea)
  const status = await h.view('move-in')
  const staged = at(status.cutovers, c => c.status === 'staged')
  await h.command('move-in.accept', { id: staged.id, revision: staged.revision }, bea, 403)
  await h.command('move-in.accept', { id: staged.id, revision: staged.revision }, ann)
  const tb = await h.view('reports/trial-balance?to=2026-08-31')
  assert.deepEqual([tb.debit, tb.credit, tb.balanced], [7066063, 7066063, true])
  const ar = await h.view('reports/receivables?to=2026-08-31'), ap = await h.view('reports/payables?to=2026-08-31')
  assert.deepEqual([ar.itemsTotal, ar.agrees, ap.itemsTotal, ap.agrees], [625000, true, 194000, true])
  assert.equal(at(ar.items, i => i.ref === '1039').open, 385000, 'an imported open item carries its open balance, not its original amount')
  const approvals = (await h.view('activity')).approvals.filter(a => a.subject_kind === 'cutover')
  assert.deepEqual(approvals.map(a => a.actor_email), ['ann@example.test'])
  // Once signed off, the import is corrected by entries, never undone.
  await h.command('move-in.undo', { jobId: again.job.id }, ann, 409)
  // The first bank statement after cutover reconciles from the imported balance.
  const checking = at((await h.view('state')).bankAccounts, b => b.name === 'Operating Checking')
  const st = await h.command('statement.import', { bankAccountId: checking.id, fileName: 'operating-checking-2026-09.csv', content: await fixture('bank/operating-checking-2026-09.csv'), opening: '24813.52', closing: '27797.02', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })
  const r = await h.view(`reconciliation/${st.statement.id}`)
  assert.ok(!r.blockers.some(b => b.kind === 'baseline' || b.kind === 'opening'), JSON.stringify(r.blockers))
})
