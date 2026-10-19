import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'

test('PAN-01 a business is set up with declared policies and each role is enforced by the server', async t => {
  const h = await harness(); t.after(() => h.close())
  const bea = await h.member('bea@example.test', 'bookkeeper'), vic = await h.member('vic@example.test', 'viewer')
  await h.command('entity.save', { legalName: 'X', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01' }, bea, 403)
  await h.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'ZZ', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01' }, h.owner, 400)
  const { acct } = await books(h)
  const e = (await h.view('state')).settings.entity
  assert.deepEqual([e.currency, e.book_basis, e.tax_method, e.state, e.fiscal_year_start], ['USD', 'accrual', 'cash', 'NY', 1])
  assert.match(e.policies, /Revenue recognized/)
  // Viewers read; they never write.
  assert.ok((await h.view('reports/trial-balance?to=2026-09-30&basis=accrual', vic)).balanced)
  await h.command('contact.save', { kind: 'customer', name: 'Cedar Studio' }, vic, 403)
  // Bookkeepers record but do not post, lock or administer.
  const draft = await h.command('journal.save-draft', { date: '2026-09-30', memo: 'Accrue fees', lines: [{ accountId: acct['6500'], debit: '250.00' }, { accountId: acct['3000'], credit: '250.00' }] }, bea)
  await h.command('journal.post', { id: draft.id, revision: draft.revision }, bea, 403)
  await h.command('period.lock', { period: '2026-09' }, bea, 403)
  await h.command('member.save', { email: 'x@example.test', name: 'x', role: 'accountant' }, bea, 403)
  // A removed role stops the very next request, on an otherwise valid session.
  await h.command('member.save', { email: 'bea@example.test', name: 'bea', role: 'bookkeeper', active: false })
  assert.equal((await h.send('/api/pantry/state', undefined, { cookie: bea })).status, 403)
  await h.command('contact.save', { kind: 'customer', name: 'Cedar Studio' }, bea, 403)
  // Signed out: nothing.
  assert.equal((await h.send('/api/pantry/state')).status, 401)
  assert.equal((await h.send('/api/pantry/command/contact.save', { kind: 'customer', name: 'Z' })).status, 401)
  // A cross-site write with a valid session is refused.
  assert.equal((await h.send('/api/pantry/command/contact.save', { kind: 'customer', name: 'Z' }, { cookie: h.owner, headers: { origin: 'https://attacker.example' } })).status, 403)
})

test('PAN-02 a chart of accounts is configured and opening balances post only after review by a second person', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct } = await books(h)
  await h.command('chart.start', {}, h.owner, 409)
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true })
  await h.command('account.save', { code: '1300', name: 'Prepaid insurance', type: 'asset' }, bea)
  await h.command('account.save', { code: '1301', name: 'Second AR', type: 'asset', subtype: 'receivable' }, bea, 409)
  await h.command('account.save', { code: '1302', name: 'Bad', type: 'income', subtype: 'bank' }, bea, 400)
  await h.command('journal.save-draft', { date: '2025-12-31', memo: 'Opening', lines: [{ accountId: acct['1000'], debit: '100.00' }, { accountId: acct['3000'], credit: '99.00' }] }, bea, 400)
  await h.command('journal.save-draft', { date: '2025-12-31', memo: 'Opening', lines: [{ accountId: acct['1200'], debit: '100.00' }, { accountId: acct['3000'], credit: '100.00' }] }, bea, 400)
  const opening = await h.command('journal.save-draft', { date: '2025-12-31', memo: 'Opening balances reviewed with accountant', lines: [{ accountId: acct['1000'], debit: '10000.00' }, { accountId: acct['1500'], debit: '2500.00' }, { accountId: acct['3000'], credit: '12500.00' }] }, bea)
  let tb = await h.view('reports/trial-balance?to=2025-12-31&basis=accrual')
  assert.equal(tb.rows.length, 0, 'a draft is not in the ledger')
  await h.command('journal.post', { id: opening.id, revision: opening.revision }, bea, 403)
  const posted = await h.command('journal.post', { id: opening.id, revision: opening.revision }, ann)
  assert.equal(posted.posted_by, 'ann@example.test')
  tb = await h.view('reports/trial-balance?to=2025-12-31&basis=accrual')
  assert.equal(tb.debit, 1250000); assert.ok(tb.balanced)
  assert.equal(at(tb.rows, r => r.code === '1000').debitBalance, 1000000)
  const cash = at((await h.view('state')).accounts, a => a.code === '1000')
  await h.command('account.save', { id: cash.id, revision: cash.revision, code: '1000', name: 'Operating checking', type: 'liability' }, bea, 409)
})

test('PAN-03 customers, vendors and source documents are kept, with document bytes returned exactly', async t => {
  const h = await harness(); t.after(() => h.close())
  await books(h)
  const vic = await h.member('vic@example.test', 'viewer')
  const cedar = await h.command('contact.save', { kind: 'customer', name: 'Cedar Studio', email: 'Billing@Cedar.example', termsDays: 15 })
  assert.equal(cedar.email, 'billing@cedar.example')
  await h.command('contact.save', { kind: 'customer', name: 'Cedar Studio' }, h.owner, 409)
  const vendor = await h.command('contact.save', { kind: 'vendor', name: 'Cedar Studio' })
  await h.command('contact.save', { id: vendor.id, revision: 'stale', kind: 'vendor', name: 'Renamed' }, h.owner, 409)
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0x10, 0x0a])
  const doc = await h.command('document.upload', { name: 'receipt.pdf', mediaType: 'application/pdf', base64: bytes.toString('base64'), note: 'Office chair' })
  assert.equal(doc.sha256, (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'))
  const r = await h.db.prepare('SELECT content FROM pt_documents WHERE id = ?').bind(doc.id).first()
  assert.deepEqual(Buffer.from(r.content), bytes)
  const download = await fetch(`${h.origin}/api/pantry/documents/${doc.id}`, { headers: { cookie: vic } })
  assert.equal(download.status, 200)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
  assert.equal((await fetch(`${h.origin}/api/pantry/documents/${doc.id}`)).status, 401)
  await h.command('contact.save', { id: cedar.id, revision: cedar.revision, kind: 'customer', name: 'Cedar Studio', active: false })
  const acct = at((await h.view('state')).accounts, a => a.code === '4000')
  await h.command('invoice.save-draft', { customerId: cedar.id, issueDate: '2026-09-01', lines: [{ description: 'x', quantity: '1', rate: '10.00', accountId: acct.id, taxCode: 'exempt' }] }, h.owner, 400)
})

test('AUDIT-001 / PAN-10 a journal entry posts balanced, approved by someone other than its preparer, for the exact version reviewed', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct } = await books(h)
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true })
  const doc = await h.command('document.upload', { name: 'accrual.txt', mediaType: 'text/plain', base64: Buffer.from('September legal work, $900').toString('base64') })
  let draft = await h.command('journal.save-draft', { date: '2026-09-30', memo: 'Accrue legal fees', documentId: doc.id, lines: [{ accountId: acct['6500'], debit: '900.00' }, { accountId: acct['3000'], credit: '900.00' }] }, bea)
  const reviewed = draft.revision
  draft = await h.command('journal.save-draft', { id: draft.id, revision: draft.revision, date: '2026-09-30', memo: 'Accrue legal fees', documentId: doc.id, lines: [{ accountId: acct['6500'], debit: '950.00' }, { accountId: acct['3000'], credit: '950.00' }] }, bea)
  await h.command('journal.post', { id: draft.id, revision: reviewed }, ann, 409)
  const posted = await h.command('journal.post', { id: draft.id, revision: draft.revision }, ann)
  assert.equal(posted.status, 'posted'); assert.equal(posted.prepared_by, 'bea@example.test'); assert.equal(posted.posted_by, 'ann@example.test'); assert.equal(posted.document_id, doc.id)
  const approvals = (await h.view('activity')).approvals.filter(a => a.subject_id === draft.id)
  assert.deepEqual(approvals.map(a => [a.actor_email, a.action, a.subject_revision]), [['ann@example.test', 'post', draft.revision]])
  // Posted lines are immutable in the database itself, not only in the API.
  await assert.rejects(h.db.prepare('UPDATE pt_journal_lines SET debit_cents = 1 WHERE entry_id = ?').bind(draft.id).run(), /PANTRY_POSTED_IMMUTABLE/)
  await assert.rejects(h.db.prepare('DELETE FROM pt_journal_entries WHERE id = ?').bind(draft.id).run(), /PANTRY_POSTED_IMMUTABLE/)
  // An agent token is not a session: the command door stays shut.
  const agent = await h.agent()
  assert.equal((await h.send('/api/pantry/command/journal.post', { id: draft.id }, { headers: { authorization: `Bearer ${agent.token}` } })).status, 401)

  // The history covers the exact revisions before and after a draft edit, and
  // the posting points to the approval of the version the accountant reviewed.
  const history = await h.view(`activity?record=${draft.id}`)
  const edit = at(history.audit, a => a.action === 'journal.edit'), posting = at(history.audit, a => a.action === 'journal.post')
  const difference = JSON.parse(edit.detail)
  assert.equal(edit.subject_revision, draft.revision)
  assert.deepEqual([difference.before.revision, difference.before.lines[0].debit, difference.after.revision, difference.after.lines[0].debit], [reviewed, 90000, draft.revision, 95000])
  assert.equal(posting.subject_revision, posted.revision)
  assert.equal(posting.approval_id, approvals[0].id)
  assert.equal(posting.approval.subject_revision, draft.revision)
  assert.equal(posting.approval.actor_email, 'ann@example.test')
  const today = posting.at.slice(0, 10)
  const filtered = await h.view(`activity?${new URLSearchParams({ person: 'ann@example.test', record: draft.id, from: today, to: today })}`)
  assert.deepEqual(filtered.audit.map(a => a.id), [posting.id])
  assert.equal((await h.view(`activity?record=${draft.id}&person=bea%40example.test`)).audit.length, 2)
  assert.equal((await h.view(`activity?record=${draft.id}&to=2000-01-01`)).audit.length, 0)
  await h.view('activity?from=2026-10-02&to=2026-10-01', h.owner, 400)
  await assert.rejects(h.db.prepare("UPDATE pt_audit SET action = 'hidden' WHERE id = ?").bind(posting.id).run(), /PANTRY_AUDIT_IMMUTABLE/)
  await assert.rejects(h.db.prepare('DELETE FROM pt_audit WHERE id = ?').bind(posting.id).run(), /PANTRY_AUDIT_IMMUTABLE/)
  await assert.rejects(h.db.prepare("UPDATE pt_approvals SET note = 'changed' WHERE id = ?").bind(approvals[0].id).run(), /PANTRY_AUDIT_IMMUTABLE/)

  const business = (await h.view('state')).settings.entity
  const revisedBusiness = await h.command('entity.save', { revision: business.revision, legalName: business.legal_name, entityType: business.entity_type, state: business.state, fiscalYearStart: business.fiscal_year_start, taxMethod: business.tax_method, booksStart: business.books_start, policies: 'Recognize revenue when invoiced; accountant reviews exceptions.' })
  const settingsEvent = at((await h.view('activity?kind=entity&record=1')).audit, a => a.action === 'entity.update')
  const settingsDifference = JSON.parse(settingsEvent.detail)
  assert.equal(settingsEvent.subject_revision, revisedBusiness.revision)
  assert.equal(settingsDifference.before.policies, business.policies)
  assert.equal(settingsDifference.after.policies, revisedBusiness.policies)

  // Agent preparation and the human approval are separate, connected events.
  const proposed = await agent.call('proposals', { kind: 'journal', summary: 'Accrue documented legal work', payload: { date: '2026-09-30', memo: 'Agent-prepared legal accrual', documentId: doc.id, passages: ['September legal work, $900'], lines: [{ accountId: acct['6500'], debit: '900.00' }, { accountId: acct['3000'], credit: '900.00' }] } })
  const decided = await h.command('proposal.decide', { id: proposed.id, revision: proposed.revision, decision: 'approve' }, ann)
  const agentEvent = at((await h.view(`activity?record=${proposed.id}`)).audit, a => a.action === 'proposal.file')
  assert.equal(agentEvent.actor_kind, 'agent'); assert.equal(agentEvent.subject_revision, proposed.revision)
  const agentPosting = at((await h.view(`activity?record=${decided.result_id}`)).audit, a => a.action === 'journal.post')
  assert.equal(agentPosting.actor_email, 'ann@example.test')
  assert.equal(agentPosting.approval.subject_id, proposed.id)
  assert.equal(agentPosting.approval.subject_revision, proposed.revision)

  // A standing bank rule retains its author and exact rule revision as the
  // authority behind the posting; it cannot masquerade as manual approval.
  const { rule } = await h.command('bank-rule.save', { name: 'Routine bank fee', payee: 'AUDIT BANK FEE', direction: 'out', accountId: acct['6500'] })
  const bank = await h.command('bank-account.save', { name: 'Audit checking', institution: 'Test bank', accountId: acct['1000'], numberLast4: '2847', routing: '', openingDate: '2026-08-31', openingBalance: '100.00' })
  await h.command('statement.import', { bankAccountId: bank.id, fileName: 'audit-september.csv', content: 'Date,Description,Amount\n09/30/2026,AUDIT BANK FEE,-5.00\n', opening: '100.00', closing: '95.00', start: '2026-09-01', end: '2026-09-30', confirmLast4: '2847' })
  const ruleEvent = at((await h.view('activity')).audit, a => a.action === 'bank-rule.file')
  assert.equal(ruleEvent.origin_kind, 'rule')
  assert.deepEqual([ruleEvent.authority_kind, ruleEvent.authority_id, ruleEvent.authority_revision], ['bank-rule', rule.id, rule.revision])
  assert.equal(ruleEvent.approval_id, null)
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM pt_audit_before').first()).n, 0, 'no transaction snapshot is left outside immutable history')
  assert.ok((await h.view('activity')).audit.every(e => e.subject_revision), 'every new write has its record or stored history revision')
})

test('PAN-11 a posted entry is corrected by a linked reversal and its history survives', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct } = await books(h)
  const draft = await h.command('journal.save-draft', { date: '2026-09-10', memo: 'Equipment bought', lines: [{ accountId: acct['1500'], debit: '1200.00' }, { accountId: acct['3000'], credit: '1200.00' }] })
  const original = await h.command('journal.post', { id: draft.id, revision: draft.revision })
  await h.command('journal.reverse', { id: original.id, date: '2026-09-01', memo: 'Too early' }, h.owner, 400)
  const reversal = await h.command('journal.reverse', { id: original.id, date: '2026-09-12', memo: 'Recorded against the wrong account' })
  assert.equal(reversal.reverses_id, original.id)
  assert.deepEqual(reversal.lines.map(l => [l.account_code, l.debit_cents, l.credit_cents]), [['1500', 0, 120000], ['3000', 120000, 0]])
  const entries = (await h.view('journal')).entries
  const kept = at(entries, e => e.id === original.id)
  assert.equal(kept.reversed_by_id, reversal.id); assert.equal(kept.status, 'posted'); assert.equal(kept.lines[0].debit_cents, 120000)
  await h.command('journal.reverse', { id: original.id, date: '2026-09-12' }, h.owner, 409)
  const tb = await h.view('reports/trial-balance?to=2026-09-30&basis=accrual')
  assert.equal(tb.rows.length, 0, 'the pair nets to nothing')
  const gl = await h.view(`reports/general-ledger?from=2026-09-01&to=2026-09-30&account=${acct['1500']}&basis=accrual`)
  assert.equal(gl.accounts[0].rows.length, 2, 'both entries stay in the ledger')
})
