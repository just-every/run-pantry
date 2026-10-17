import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { at, fixture, harness } from './harness.mjs'
import { fakeXero } from './xero.mjs'

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

const XERO = { accounts: 'chart-of-accounts.csv', contacts: 'contacts.csv', trialBalance: 'trial-balance.csv', invoices: 'sales-invoices.csv', bills: 'bills.csv', bankTransactions: 'account-transactions.csv' }
async function xeroExports(overrides = {}) {
  const files = {}
  for (const [key, name] of Object.entries(XERO)) files[key] = { name, content: overrides[key] ?? await fixture(`xero/${name}`) }
  return { source: 'xero', files, banks: [{ account: 'Checking Account', institution: 'First Harbor Bank', last4: '4821', statementBalance: '31406.87' }, { account: 'Savings Account', institution: 'First Harbor Bank', last4: '7730', statementBalance: '12000.00' }] }
}

test('XERO-001 Xero exports are previewed, imported, carry their attachments over, undone, and sign off to Xero\'s trial balance to the cent', async t => {
  const xero = await fakeXero()
  const h = await harness({ bindings: xero.bindings, outbound: xero.outbound }); t.after(() => h.close())
  await h.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: '2026-09-01' })
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true })
  const pkg = await xeroExports()
  // Preview: what comes in, what does not and why, every tie-out; nothing written.
  const preview = await h.command('move-in.preview', pkg, bea)
  assert.equal(preview.cutoverDate, '2026-08-31')
  assert.deepEqual(Object.fromEntries(Object.entries(preview.counts).map(([k, v]) => [k, v.accepted])), { accounts: 20, customers: 4, vendors: 5, bankAccounts: 2, trialBalance: 17, openInvoices: 2, unpaidBills: 2, historyLines: 8 })
  assert.ok(preview.checks.every(c => c.ok), JSON.stringify(preview.checks.filter(c => !c.ok)))
  assert.ok(preview.checks.some(c => c.key === 'history:Checking Account'), 'the bank transactions run to the trial balance')
  assert.equal(preview.refused.length, 0)
  assert.deepEqual(Object.fromEntries(preview.notImported.map(l => [l.what, l.count])), { 'Paid invoices': 1, 'Draft invoices': 1, 'Voided invoices': 1, 'Invoices dated after the cutover date': 1, 'Credit notes on invoices': 1, 'Paid bills': 2, 'Voided bills': 1, 'Contacts on no invoice or bill': 1, 'Bank transactions as ledger entries': 8, Attachments: 0 })
  assert.equal(await count(h, 'pt_accounts') + await count(h, 'ik_jobs'), 0)
  // An invoice paid in Xero after the cutover date leaves receivables short of the trial balance: no import.
  const paidLater = (await fixture('xero/sales-invoices.csv')).replace('INV-0118,Patient brochure,08/10/2026,09/09/2026,5933.45,453.45,0.00,5933.45', 'INV-0118,Patient brochure,08/10/2026,09/09/2026,5933.45,453.45,5933.45,0.00').replace(/(INV-0118,.*),Awaiting Payment/, '$1,Paid')
  const short = await h.command('move-in.preview', await xeroExports({ invoices: paidLater }), bea)
  assert.equal(at(short.checks, c => c.key === 'ar').ok, false)
  await h.command('move-in.commit', { ...(await xeroExports({ invoices: paidLater })), fingerprint: short.fingerprint }, bea, 409)
  // Commit: staged records and a draft opening entry; nothing posts yet.
  const { job } = await h.command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint }, bea)
  assert.equal(job.state, 'completed')
  assert.deepEqual([await count(h, 'pt_accounts'), await count(h, 'pt_contacts'), await count(h, 'pt_bank_accounts'), await count(h, 'pt_invoices'), await count(h, 'pt_bills'), await count(h, 'pt_history_lines')], [20, 9, 2, 2, 2, 8])
  assert.equal((await h.view('reports/trial-balance?to=2026-08-31')).rows.length, 0, 'nothing posts before sign-off')
  const report = at((await h.view('move-in')).reports, r => r.jobId === job.id)
  assert.equal(report.leftOut.find(l => l.what === 'Paid invoices').count, 1, 'the page keeps what did not come in')
  // Attachments: connect Xero (read-only scopes), come back from Xero, carry each open item's files over.
  const { url } = await h.command('move-in.xero.connect', {}, bea)
  const authorize = new URL(url)
  assert.equal(authorize.origin + authorize.pathname, 'https://login.xero.com/identity/connect/authorize')
  assert.equal(authorize.searchParams.get('redirect_uri'), `${h.origin}/api/pantry/xero/callback`)
  assert.deepEqual(authorize.searchParams.get('scope').split(' ').filter(s => s.startsWith('accounting')), ['accounting.invoices.read', 'accounting.attachments.read'])
  const beaCookie = { cookie: bea }
  const forged = await h.send(`/api/pantry/xero/callback?code=recorded-authorization-code&state=forged`, undefined, beaCookie)
  assert.match(forged.headers.get('location'), /xero_error=/)
  const back = await h.send(`/api/pantry/xero/callback?code=recorded-authorization-code&state=${authorize.searchParams.get('state')}`, undefined, beaCookie)
  assert.equal(back.headers.get('location'), '/app/move-in?xero=connected')
  let carried = await h.command('move-in.xero.carry', {}, bea)
  while (!carried.done) carried = await h.command('move-in.xero.carry', {}, bea)
  assert.equal(carried.connection.tenantName, 'Juniper Lane Design LLC', 'the organisation chosen in this sign-in, not an older connection')
  assert.deepEqual([carried.items, carried.carried, carried.tooLarge, carried.notFound.length], [4, 3, 1, 0])
  const docs = await h.db.prepare("SELECT d.name, d.sha256, d.linked_kind, i.number, b.reference FROM pt_documents d LEFT JOIN pt_invoices i ON i.id = d.linked_id LEFT JOIN pt_bills b ON b.id = d.linked_id ORDER BY d.name").all()
  const recorded = Object.fromEntries(await Promise.all(xero.files.filter(f => f._file).map(async f => [f.FileName, createHash('sha256').update(await xero.fileBytes(f._file)).digest('hex')])))
  assert.deepEqual(docs.results.map(d => [d.name, d.linked_kind, d.number ?? d.reference, d.sha256]), [
    ['BR-0826.pdf', 'bill', 'BR-0826', recorded['BR-0826.pdf']],
    ['INV-0112 signed proposal.pdf', 'invoice', 'INV-0112', recorded['INV-0112 signed proposal.pdf']],
    ['receipt.png', 'bill', 'CL-2291', recorded['receipt.png']],
  ], 'each file kept byte for byte on its own record; the other supplier\'s CL-2291 is left alone')
  assert.ok(!xero.state.calls.some(c => c.includes('8d833f4d') || c.includes('7c722e3c')), 'neither the other supplier\'s file nor the oversized one is downloaded')
  // Undo removes the staged records and the files carried onto them.
  await h.command('move-in.undo', { jobId: job.id }, ann)
  assert.deepEqual([await count(h, 'pt_accounts'), await count(h, 'pt_contacts'), await count(h, 'pt_journal_entries'), await count(h, 'pt_cutovers'), await count(h, 'pt_documents'), await count(h, 'pt_xero_attachments')], [0, 0, 0, 0, 0, 0])
  // Import again and sign off: Pantry's trial balance is Xero's, account by account, to the cent.
  await h.command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint }, bea)
  const staged = at((await h.view('move-in')).cutovers, c => c.status === 'staged')
  assert.equal(staged.source, 'xero')
  await h.command('move-in.accept', { id: staged.id, revision: staged.revision }, ann)
  const tb = await h.view('reports/trial-balance?to=2026-08-31')
  const xeroTb = (await fixture('xero/trial-balance.csv')).split(/\r?\n/).map(l => /^"?(.+) \((\d+)\)"?,("[\d,.]+"|[\d.]*),("[\d,.]+"|[\d.]*),/.exec(l)).filter(Boolean)
    .map(m => [m[2], Math.round(Number(m[3].replace(/[",]/g, '') || 0) * 100), Math.round(Number(m[4].replace(/[",]/g, '') || 0) * 100)])
  assert.deepEqual(tb.rows.map(r => [r.code, r.debitBalance, r.creditBalance]).sort(), xeroTb.sort())
  assert.deepEqual([tb.debit, tb.credit, tb.balanced], [9636058, 9636058, true])
  const ar = await h.view('reports/receivables?to=2026-08-31'), ap = await h.view('reports/payables?to=2026-08-31')
  assert.deepEqual([ar.itemsTotal, ar.agrees, ap.itemsTotal, ap.agrees], [918345, true, 231708, true])
  // Disconnecting ends Pantry's access at Xero.
  await h.command('move-in.xero.disconnect', {}, bea)
  assert.deepEqual(xero.state.revoked, [xero.token.refresh_token])
})
