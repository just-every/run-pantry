import type { Bindings } from './auth.server'
import { SERVICE_CHART } from './pantry/accounts'
import { addDays, sha256 } from './pantry/core'
import { demoId as id, records } from './demo/records'

const OWNER_NAME = 'Priya Shah', TAYLOR = 'taylor@juniperlane.example', MORGAN = 'morgan@leecpa.example'

/** Juniper Lane Design, adapted from tests/api/scenario.mjs and the QBO fixtures.
 * Real, editable books: no network or external service is involved in seeding. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
  const r = records(env.DB), at = now.toISOString(), today = at.slice(0, 10)
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
  const day = (n: number) => `${month}-${String(n).padStart(2, '0')}`
  const start = day(1), openingDay = addDays(start, -1), end = addDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10), -1)
  const owner = await env.DB.prepare('SELECT id FROM oa_operators WHERE lower(email) = ?').bind(ownerEmail.toLowerCase()).first<{ id: string }>()
  if (!owner) throw new Error('Demo owner is not ready')
  r.sql('UPDATE oa_operators SET display_name = ? WHERE id = ?', OWNER_NAME, owner.id)
  r.add('oa_first_run', { singleton: 1, completed_by: owner.id, completed_at: now.getTime() })
  r.add('pt_entity', { id: 1, legal_name: 'Juniper Lane Design LLC', entity_type: 'single-member-llc', state: 'NY', fiscal_year_start: 1, tax_method: 'cash', policies: 'Accrual books in USD. Revenue recognised when invoiced. Accountant: Morgan Lee CPA.', books_start: openingDay, revision: id('entity'), updated_by: ownerEmail, updated_at: at })
  for (const [code, name, type, subtype] of [...SERVICE_CHART, ['1010', 'Savings', 'asset', 'bank']])
    r.add('pt_accounts', { id: id(code), code, name, type, subtype, revision: id(code) })
  for (const [email, name, role, post] of [[TAYLOR, 'Taylor Kim', 'bookkeeper', 0], [MORGAN, 'Morgan Lee CPA', 'accountant', 1]])
    r.add('pt_members', { email, name, role, can_post: post, can_reopen: post, revision: id(String(name)) })
  const contacts = [
    ['cedar', 'customer', 'Cedar Studio'], ['northstar', 'customer', 'Northstar Consulting'], ['willow', 'customer', 'Willow Services'], ['harbor-lights', 'customer', 'Harbor Lights Cafe'],
    ['brightline', 'vendor', 'Brightline Software'], ['harbor', 'vendor', 'Harbor Office Rentals'], ['paper', 'vendor', 'Paper & Pine Supply'],
  ]
  for (const [key, kind, name] of contacts) r.add('pt_contacts', { id: id(key), kind, name, email: `accounts@${name.toLowerCase().replace(/[^a-z]+/g, '')}.example`, revision: id(key) })
  r.add('pt_tax_codes', { id: id('nyc'), name: 'New York City', rate_milli_percent: 8875, account_id: id('2200'), revision: id('nyc') })
  for (const [key, name, code, last4, amount] of [['checking', 'Operating checking', '1000', '4821', 2481352], ['savings', 'Savings', '1010', '7730', 0]] as const)
    r.add('pt_bank_accounts', { id: id(key), name, account_id: id(code), institution: 'Chase', number_last4: last4, opening_date: openingDay, opening_cents: amount, revision: id(key) })

  let number = 1
  const entry = (key: string, date: string, memo: string, kind: string, source: string, lines: [string, number, number][], posted = true) => {
    const entryId = id(`journal-${key}`)
    r.add('pt_journal_entries', { id: entryId, number: number++, entry_date: date, memo, source_kind: kind, source_id: source, status: 'draft', prepared_by: TAYLOR, prepared_kind: 'person', revision: entryId, created_at: at })
    lines.forEach(([account, debit, credit], i) => r.add('pt_journal_lines', { id: id(`line-${key}-${i}`), entry_id: entryId, line_no: i + 1, account_id: id(account), debit_cents: debit, credit_cents: credit }))
    if (posted) r.sql("UPDATE pt_journal_entries SET status = 'posted', posted_by = ?, posted_at = ? WHERE id = ? AND status = 'draft'", ownerEmail, at, entryId)
    return entryId
  }
  entry('opening', openingDay, 'Opening balances', 'opening', id('opening'), [['1000', 2481352, 0], ['3000', 0, 2481352]])
  const invoices = [
    ['cedar-site', 'cedar', '1041', 'Website refresh', 240000, 1, 'issued'], ['northstar-retainer', 'northstar', '1042', 'Quarterly retainer', 385000, 2, 'issued'],
    ['willow-brand', 'willow', '1043', 'Brand workshop', 140000, 5, 'issued'], ['cedar-social', 'cedar', '1044', 'Social templates', 120000, 12, 'issued'],
    ['cafe-menu', 'harbor-lights', '1045', 'Seasonal menu redesign', 95000, 20, 'approved'], ['willow-followup', 'willow', '1046', 'Brand rollout planning', 175000, 24, 'draft'],
  ] as const
  for (const [key, customer, ref, description, amount, date, status] of invoices) {
    const journal = status === 'issued' ? entry(key, day(date), `Invoice ${ref} · ${description}`, 'invoice', id(key), [['1200', amount, 0], ['4000', 0, amount]]) : null
    r.add('pt_invoices', { id: id(key), kind: 'invoice', number: ref, customer_id: id(customer), issue_date: day(date), due_date: addDays(day(date), 30), status, memo: description, subtotal_cents: amount, tax_cents: 0, total_cents: amount, journal_id: journal, prepared_by: TAYLOR, approved_by: status === 'draft' ? null : MORGAN, approved_revision: status === 'draft' ? null : id(key), issued_by: status === 'issued' ? ownerEmail : null, revision: id(key), created_at: at })
    r.add('pt_invoice_lines', { id: id(`${key}-item`), invoice_id: id(key), line_no: 1, description, quantity_milli: 1000, unit_cents: amount, amount_cents: amount, account_id: id('4000'), tax_code: 'exempt' })
  }
  for (const [key, vendor, ref, description, code, amount] of [['software', 'brightline', 'INV-88', 'Design software subscriptions', '6200', 64000], ['rent', 'harbor', 'R-09', 'Studio rent', '6100', 130000], ['supplies', 'paper', 'PP-204', 'Workshop paper and supplies', '6300', 18650]] as const) {
    const journal = entry(key, day(1), description, 'bill', id(key), [[code, amount, 0], ['2000', 0, amount]])
    r.add('pt_bills', { id: id(key), vendor_id: id(vendor), reference: ref, bill_date: day(1), due_date: end, status: 'posted', total_cents: amount, journal_id: journal, prepared_by: TAYLOR, revision: id(key), created_at: at })
    r.add('pt_bill_lines', { id: id(`${key}-item`), bill_id: id(key), line_no: 1, description, account_id: id(code), amount_cents: amount })
  }
  for (const [key, contact, target, date, amount, direction] of [['cedar-paid', 'cedar', 'cedar-site', 3, 240000, 'received'], ['willow-paid', 'willow', 'willow-brand', 18, 140000, 'received'], ['rent-paid', 'harbor', 'rent', 24, 130000, 'paid']] as const) {
    const incoming = direction === 'received'
    const journal = entry(key, day(date), `Payment ${incoming ? 'from' : 'to'} ${contacts.find(c => c[0] === contact)![2]}`, 'payment', id(key), incoming ? [['1000', amount, 0], ['1200', 0, amount]] : [['2000', amount, 0], ['1000', 0, amount]])
    r.add('pt_payments', { id: id(key), direction, contact_id: id(contact), payment_date: day(date), amount_cents: amount, bank_account_id: id('checking'), journal_id: journal, recorded_by: ownerEmail, created_at: at })
    r.add('pt_allocations', { id: id(`${key}-allocation`), source_kind: 'payment', source_id: id(key), target_kind: incoming ? 'invoice' : 'bill', target_id: id(target), amount_cents: amount, allocation_date: day(date), created_by: ownerEmail, created_at: at })
  }
  entry('accrual', today, 'Monthly bookkeeping fee on business card', 'manual', id('accrual'), [['6500', 35000, 0], ['2100', 0, 35000]], false)
  const bankLines = [[3, 240000, 'CEDAR STUDIO'], [8, -64000, 'BRIGHTLINE SOFTWARE'], [18, 140000, 'WILLOW SERVICES'], [24, -130000, 'CHECK 2052 HARBOR RENT'], [28, -1200, 'MONTHLY SERVICE FEE']] as const
  const csv = 'Date,Description,Amount\n' + bankLines.map(([d, amount, description]) => `${day(d)},${description},${(amount / 100).toFixed(2)}`).join('\n')
  const content = new TextEncoder().encode(csv), digest = await sha256(content)
  r.add('pt_documents', { id: id('statement-file'), name: `operating-checking-${month}.csv`, media_type: 'text/csv', size: content.length, sha256: digest, content: content.buffer, linked_kind: 'statement', linked_id: id('statement'), note: 'Monthly operating checking statement', uploaded_by: ownerEmail, uploaded_at: at })
  r.add('pt_statements', { id: id('statement'), bank_account_id: id('checking'), format: 'csv', source_name: `operating-checking-${month}.csv`, source_sha256: digest, start_date: start, end_date: end, opening_cents: 2481352, closing_cents: 2666152, line_count: bankLines.length, duplicate_count: 0, document_id: id('statement-file'), imported_by: ownerEmail, imported_at: at })
  bankLines.forEach(([date, amount, description], i) => r.add('pt_bank_lines', { id: id(`bank-${i}`), statement_id: id('statement'), bank_account_id: id('checking'), posted_date: day(date), amount_cents: amount, description, fingerprint: id(`bank-${i}`) }))
  for (const taskMonth of [month, today.slice(0, 7)])
  for (const [i, title] of ['Review bank reconciliation', 'Review receivables and payables', 'Check supporting documents', 'Review accruals with accountant'].entries())
    r.add('pt_close_tasks', { id: id(`close-${taskMonth}-${i}`), period: taskMonth, title, status: i === 1 ? 'done' : 'open', note: i === 1 ? 'Customer balances checked against invoices.' : '', done_by: i === 1 ? ownerEmail : null, done_at: i === 1 ? at : null, revision: id(`close-${taskMonth}-${i}`) })
  r.add('pt_agents', { id: id('agent'), name: 'Juniper books assistant', token_hash: await sha256('demo-agent-with-no-issued-token'), created_by: ownerEmail, created_at: at, revision: id('agent') })
  r.add('pt_proposals', { id: id('proposal'), agent_id: id('agent'), kind: 'variance-note', summary: 'Explain the Northstar retainer in service revenue', payload: JSON.stringify({ period: month, body: 'The quarterly Northstar retainer contributed $3,850 of the $8,850 invoiced this month. It remains open for follow-up; this explanation changes no ledger figures.', citations: [id('journal-northstar-retainer')] }), refs: JSON.stringify([{ kind: 'journal', id: id('journal-northstar-retainer'), revision: id('journal-northstar-retainer') }]), status: 'proposed', created_at: at, revision: id('proposal') })
  for (const key of ['northstar-retainer', 'cafe-menu'])
    r.add('pt_approvals', { id: id(`approval-${key}`), subject_kind: 'invoice', subject_id: id(key), subject_revision: id(key), action: 'approve', decision: 'approved', actor_email: MORGAN, note: 'Scope and tax treatment reviewed.', at })
  r.add('pt_notes', { id: id('variance'), kind: 'variance', period: month, body: 'Northstar retainer is the largest open receivable. Follow up before the next close.', evidence: '[]', approved_by: ownerEmail, approved_at: at })
  for (const [i, action, kind, subject] of [[1, 'chart.start', 'chart', 'service-business'], [2, 'invoice.issue', 'invoice', id('northstar-retainer')], [3, 'statement.import', 'statement', id('statement')]] as const)
    r.add('pt_audit', { id: id(`audit-${i}`), at: `${today}T09:0${i}:00.000Z`, actor_email: ownerEmail, actor_kind: 'person', action, subject_kind: kind, subject_id: subject, detail: '{}' })
  await r.save()
}
