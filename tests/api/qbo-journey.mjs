import assert from 'node:assert/strict'
import { harness } from './harness.mjs'

/** The external Intuit edge only; auth, import kit and books are the real Worker. */
export function qboEdge() {
  const to = '2026-08-31', from = '2024-09-01'
  const Account = [
    { Id: 'synthetic-pantry-101', Name: 'Receivables', AccountType: 'Accounts Receivable', AcctNum: '1100' },
    { Id: 'synthetic-pantry-102', Name: 'Payables', AccountType: 'Accounts Payable', AcctNum: '2100' },
    { Id: 'synthetic-pantry-103', Name: 'Opening equity', AccountType: 'Equity', AcctNum: '3000' },
  ]
  const snapshot = { format: 'pantry-qbo-read-1', from, to, Account,
    Customer: [{ Id: 'synthetic-pantry-104', DisplayName: 'Cedar Studio' }], Vendor: [{ Id: 'synthetic-pantry-105', DisplayName: 'Acme Contractors' }],
    Invoice: [{ Id: 'synthetic-pantry-106', DocNumber: 'CEDAR-10', CustomerRef: { value: 'synthetic-pantry-104' }, TxnDate: '2026-08-01', DueDate: to, TotalAmt: 100, Balance: 100 }],
    Bill: [{ Id: 'synthetic-pantry-107', DocNumber: 'ACME-20', VendorRef: { value: 'synthetic-pantry-105' }, TxnDate: '2026-08-02', DueDate: to, TotalAmt: 50, Balance: 50 }], Attachable: [],
    TrialBalance: { Header: { EndPeriod: to, ReportBasis: 'Accrual', Currency: 'USD' }, Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Debit' }, { ColTitle: 'Credit' }] }, Rows: { Row: Account.map((a, i) => ({ ColData: [{ id: a.Id, value: a.Name }, { value: i === 0 ? '100.00' : '' }, { value: i === 0 ? '' : '50.00' }] })) } },
    GeneralLedger: { Header: { StartPeriod: from, EndPeriod: to, ReportBasis: 'Accrual' }, Columns: { Column: ['tx_date', 'txn_type', 'doc_num', 'name', 'memo', 'subt_nat_amount'].map(Value => ({ ColType: Value === 'tx_date' ? 'Date' : Value === 'subt_nat_amount' ? 'Money' : 'String', MetaData: [{ Name: 'ColKey', Value }] })) }, Rows: { Row: [{ Header: { ColData: [{ value: 'Receivables' }] }, Rows: { Row: [{ ColData: [{ value: '2026-08-01' }, { id: 'synthetic-pantry-106', value: 'Invoice' }, { value: 'CEDAR-10' }, { value: 'Cedar Studio' }, { value: 'Design engagement' }, { value: '100.00' }] }] } }] } },
  }
  const bindings = { QBO_CLIENT_ID: 'synthetic-pantry-108', QBO_CLIENT_SECRET: 'synthetic-pantry-109' }
  const outbound = async request => {
    const url = new URL(request.url)
    if (url.hostname === 'oauth.platform.intuit.com') return Response.json({ access_token: 'synthetic-pantry-110', refresh_token: 'synthetic-pantry-111', expires_in: 3600 })
    assert.equal(url.hostname, 'sandbox-quickbooks.api.intuit.com')
    assert.equal(request.headers.get('authorization'), 'Bearer synthetic-pantry-110')
    if (url.pathname.includes('/companyinfo/')) return Response.json({ CompanyInfo: { Id: '123456789' } })
    const resource = url.pathname.split('/').at(-1)
    if (resource === 'query') { const entity = /FROM (\w+)/.exec(url.searchParams.get('query'))[1]; return Response.json({ QueryResponse: { [entity]: snapshot[entity] } }) }
    return Response.json(snapshot[resource])
  }
  return { bindings, outbound, snapshot }
}

export async function readQbo(command, from, to) {
  const snapshot = { format: 'pantry-qbo-read-1', from, to }
  for (const resource of ['Account', 'Customer', 'Vendor', 'Invoice', 'Bill', 'Attachable']) {
    snapshot[resource] = []; let start = 1
    do { const page = await command('move-in.qbo.read', { resource, start }); snapshot[resource].push(...page.rows); start = page.next } while (start !== null)
  }
  for (const resource of ['TrialBalance', 'GeneralLedger']) snapshot[resource] = (await command('move-in.qbo.read', { resource, from, to })).report
  return { source: 'quickbooks-online', files: { apiSnapshot: { name: 'quickbooks-api-snapshot.json', content: JSON.stringify(snapshot) } }, banks: [] }
}

export async function qboApiJourney(t) {
  const edge = qboEdge(), h = await harness(edge); t.after(() => h.close())
  await h.command('entity.save', { legalName: 'Cedar Design Studio', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: '2026-09-01' })
  await h.command('move-in.qbo.connect', { realmId: '123456789', environment: 'sandbox', refreshToken: 'synthetic-pantry-112' })
  const viewer = await h.member('synthetic-pantry-113@example.test', 'viewer')
  await h.command('move-in.qbo.read', { resource: 'Invoice' }, viewer, 403)
  await h.command('move-in.qbo.read', { resource: 'Unsupported' }, undefined, 400)
  const pkg = await readQbo(h.command, edge.snapshot.from, edge.snapshot.to), preview = await h.command('move-in.preview', pkg)
  assert.ok(preview.checks.every(c => c.ok), JSON.stringify(preview.checks)); assert.deepEqual(preview.refused, [])
  const { job } = await h.command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint })
  const source = (await h.db.prepare("SELECT record_json FROM ik_provenance WHERE target_kind='invoice'").all()).results.map(r => JSON.parse(r.record_json))
  assert.equal(source[0].sourceId, 'synthetic-pantry-106')
  assert.equal((await h.view('move-in')).history, 1)
  await h.command('move-in.undo', { jobId: job.id })
  assert.equal((await h.view('state')).accounts.length, 0)
  await h.command('move-in.commit', { ...pkg, fingerprint: (await h.command('move-in.preview', pkg)).fingerprint })
  const cut = (await h.view('move-in')).cutovers[0]
  await h.command('move-in.accept', { id: cut.id, revision: cut.revision })
  const ar = await h.view('reports/receivables?to=2026-08-31'), ap = await h.view('reports/payables?to=2026-08-31')
  assert.deepEqual([ar.itemsTotal, ar.agrees, ap.itemsTotal, ap.agrees], [10000, true, 5000, true])
  const sealed = await h.db.prepare('SELECT tokens FROM pt_qbo_connection').first()
  assert.ok(!sealed.tokens.includes('synthetic-pantry-110') && !sealed.tokens.includes('synthetic-pantry-111'))
  await h.command('move-in.qbo.disconnect', {})
  await h.command('move-in.qbo.read', { resource: 'Invoice' }, undefined, 409)
}
