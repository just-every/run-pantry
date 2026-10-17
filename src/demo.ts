import type { Bindings } from './auth.server'
import { SERVICE_CHART } from './pantry/accounts'
import { addDays, sha256 } from './pantry/core'
import { closeMonth } from './demo/close'
import { seedFeeds } from './demo/feeds'
import { demoId as id, records } from './demo/records'

const OWNER_NAME = 'Priya Shah', TAYLOR = 'taylor@juniperlane.example', MORGAN = 'morgan@leecpa.example'
const OPENING = 2395552

/** Juniper Lane Design, adapted from tests/api/scenario.mjs and the QBO fixtures.
 * Real, editable books: no network or external service is involved in seeding.
 * The month before last is closed (matched, reconciled and locked through Pantry's
 * own close code); last month is open with a statement to reconcile. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
  const r = records(env.DB), at = now.toISOString(), today = at.slice(0, 10)
  const monthBack = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1)).toISOString().slice(0, 7)
  const month = monthBack(1), prior = monthBack(2)
  const inMonth = (id: string) => (n: number) => `${id}-${String(n).padStart(2, '0')}`
  const day = inMonth(month), priorDay = inMonth(prior)
  const start = day(1), priorEnd = addDays(start, -1), openingDay = addDays(priorDay(1), -1), end = addDays(`${monthBack(0)}-01`, -1)
  const owner = await env.DB.prepare('SELECT id FROM oa_operators WHERE lower(email) = ?').bind(ownerEmail.toLowerCase()).first<{ id: string }>()
  if (!owner) throw new Error('Demo owner is not ready')
  r.sql('UPDATE oa_operators SET display_name = ? WHERE id = ?', OWNER_NAME, owner.id)
  r.add('oa_first_run', { singleton: 1, completed_by: owner.id, completed_at: now.getTime() })
  r.add('pt_entity', { id: 1, legal_name: 'Juniper Lane Design LLC', entity_type: 'single-member-llc', state: 'NY', fiscal_year_start: 1, tax_method: 'cash', policies: 'Accrual books in USD. Revenue recognized when invoiced. Accountant: Morgan Lee CPA.', books_start: openingDay, revision: id('entity'), updated_by: ownerEmail, updated_at: at })
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
  for (const [key, name, code, last4, amount] of [['checking', 'Operating checking', '1000', '4821', OPENING], ['savings', 'Savings', '1010', '7730', 0]] as const)
    r.add('pt_bank_accounts', { id: id(key), name, account_id: id(code), institution: 'Chase', number_last4: last4, opening_date: openingDay, opening_cents: amount, revision: id(key) })

  let number = 1
  const entry = (key: string, date: string, memo: string, kind: string, source: string, lines: [string, number, number][], posted = true) => {
    const entryId = id(`journal-${key}`)
    r.add('pt_journal_entries', { id: entryId, number: number++, entry_date: date, memo, source_kind: kind, source_id: source, status: 'draft', prepared_by: TAYLOR, prepared_kind: 'person', revision: entryId, created_at: at })
    lines.forEach(([account, debit, credit], i) => r.add('pt_journal_lines', { id: id(`line-${key}-${i}`), entry_id: entryId, line_no: i + 1, account_id: id(account), debit_cents: debit, credit_cents: credit }))
    if (posted) r.sql("UPDATE pt_journal_entries SET status = 'posted', posted_by = ?, posted_at = ? WHERE id = ? AND status = 'draft'", ownerEmail, at, entryId)
    return entryId
  }
  const invoice = (key: string, customer: string, ref: string, description: string, amount: number, date: string, status: string) => {
    const journal = status === 'issued' ? entry(key, date, `Invoice ${ref} · ${description}`, 'invoice', id(key), [['1200', amount, 0], ['4000', 0, amount]]) : null
    r.add('pt_invoices', { id: id(key), kind: 'invoice', number: ref, customer_id: id(customer), issue_date: date, due_date: addDays(date, 30), status, memo: description, subtotal_cents: amount, tax_cents: 0, total_cents: amount, journal_id: journal, prepared_by: TAYLOR, approved_by: status === 'draft' ? null : MORGAN, approved_revision: status === 'draft' ? null : id(key), issued_by: status === 'issued' ? ownerEmail : null, revision: id(key), created_at: at })
    r.add('pt_invoice_lines', { id: id(`${key}-item`), invoice_id: id(key), line_no: 1, description, quantity_milli: 1000, unit_cents: amount, amount_cents: amount, account_id: id('4000'), tax_code: 'exempt' })
  }
  const bill = (key: string, vendor: string, ref: string, description: string, code: string, amount: number, date: string, due: string, evidenceWaived: string | null = null) => {
    const journal = entry(key, date, description, 'bill', id(key), [[code, amount, 0], ['2000', 0, amount]])
    r.add('pt_bills', { id: id(key), vendor_id: id(vendor), reference: ref, bill_date: date, due_date: due, status: 'posted', total_cents: amount, evidence_waived: evidenceWaived, journal_id: journal, prepared_by: TAYLOR, revision: id(key), created_at: at })
    r.add('pt_bill_lines', { id: id(`${key}-item`), bill_id: id(key), line_no: 1, description, account_id: id(code), amount_cents: amount })
  }
  const payment = (key: string, contact: string, target: string, date: string, amount: number, direction: 'received' | 'paid') => {
    const incoming = direction === 'received'
    const journal = entry(key, date, `Payment ${incoming ? 'from' : 'to'} ${contacts.find(c => c[0] === contact)![2]}`, 'payment', id(key), incoming ? [['1000', amount, 0], ['1200', 0, amount]] : [['2000', amount, 0], ['1000', 0, amount]])
    r.add('pt_payments', { id: id(key), direction, contact_id: id(contact), payment_date: date, amount_cents: amount, bank_account_id: id('checking'), journal_id: journal, recorded_by: ownerEmail, created_at: at })
    r.add('pt_allocations', { id: id(`${key}-allocation`), source_kind: 'payment', source_id: id(key), target_kind: incoming ? 'invoice' : 'bill', target_id: id(target), amount_cents: amount, allocation_date: date, created_by: ownerEmail, created_at: at })
  }
  const document = async (key: string, name: string, mediaType: string, text: string, linkedKind: string, linkedId: string, note: string) => {
    const content = new TextEncoder().encode(text), digest = await sha256(content)
    r.add('pt_documents', { id: id(key), name, media_type: mediaType, size: content.length, sha256: digest, content: content.buffer, linked_kind: linkedKind, linked_id: linkedId, note, uploaded_by: ownerEmail, uploaded_at: at })
    return digest
  }
  const statement = async (key: string, bank: string, label: string, period: string, from: string, to: string, opening: number, lines: readonly (readonly [string, number, string, ...unknown[]])[]) => {
    const name = `${label}-${period}.csv`
    const digest = await document(`${key}-file`, name, 'text/csv', 'Date,Description,Amount\n' + lines.map(([d, amount, description]) => `${d},${description},${(amount / 100).toFixed(2)}`).join('\n'), 'statement', id(key), `Monthly ${label.replace('-', ' ')} statement`)
    r.add('pt_statements', { id: id(key), bank_account_id: id(bank), format: 'csv', source_name: name, source_sha256: digest, start_date: from, end_date: to, opening_cents: opening, closing_cents: opening + lines.reduce((s, l) => s + l[1], 0), line_count: lines.length, duplicate_count: 0, document_id: id(`${key}-file`), imported_by: ownerEmail, imported_at: at })
    lines.forEach(([date, amount, description], i) => r.add('pt_bank_lines', { id: id(`${key}-line-${i}`), statement_id: id(key), bank_account_id: id(bank), posted_date: date, amount_cents: amount, description, fingerprint: id(`${key}-line-${i}`) }))
  }
  const tasks = (period: string, done: (i: number) => boolean, note: (i: number) => string, by: (i: number) => string, when: (i: number) => string) => {
    for (const [i, title] of ['Review bank reconciliation', 'Review receivables and payables', 'Check supporting documents', 'Review accruals with accountant'].entries())
      r.add('pt_close_tasks', { id: id(`close-${period}-${i}`), period, title, status: done(i) ? 'done' : 'open', note: done(i) ? note(i) : '', done_by: done(i) ? by(i) : null, done_at: done(i) ? when(i) : null, revision: id(`close-${period}-${i}`) })
  }

  entry('opening', openingDay, 'Opening balances', 'opening', id('opening'), [['1000', OPENING, 0], ['3000', 0, OPENING]])

  // The month before last: invoiced, billed and paid; closed below.
  invoice('cedar-guidelines', 'cedar', '1037', 'Brand guidelines', 185000, priorDay(1), 'issued')
  invoice('cafe-photos', 'harbor-lights', '1038', 'Menu photography', 96000, priorDay(5), 'issued')
  bill('software-prior', 'brightline', 'INV-71', 'Design software subscriptions', '6200', 64000, priorDay(1), priorEnd)
  await document('software-prior-receipt', 'brightline-INV-71.txt', 'text/plain', `Brightline Software\nInvoice INV-71 · ${priorDay(1)}\nTeam plan, 4 seats: $640.00\nPaid by bank transfer\n`, 'bill', id('software-prior'), 'Vendor invoice')
  bill('rent-prior', 'harbor', 'R-08', 'Studio rent', '6100', 130000, priorDay(1), priorEnd, `Monthly rent under the studio lease on file — ${ownerEmail}`)
  payment('software-prior-paid', 'brightline', 'software-prior', priorDay(9), 64000, 'paid')
  payment('cafe-photos-paid', 'harbor-lights', 'cafe-photos', priorDay(12), 96000, 'received')
  payment('rent-prior-paid', 'harbor', 'rent-prior', priorDay(24), 130000, 'paid')
  payment('cedar-guidelines-paid', 'cedar', 'cedar-guidelines', priorDay(26), 185000, 'received')
  entry('fee-prior', priorDay(28), 'Monthly service fee', 'bank', id('fee-prior'), [['6400', 1200, 0], ['1000', 0, 1200]])
  // Each statement line with the ledger line it clears: [date, amount, description, entry key, line index].
  const priorLines = [[priorDay(9), -64000, 'BRIGHTLINE SOFTWARE', 'software-prior-paid', 1], [priorDay(12), 96000, 'HARBOR LIGHTS CAFE', 'cafe-photos-paid', 0], [priorDay(24), -130000, 'CHECK 2047 HARBOR RENT', 'rent-prior-paid', 1], [priorDay(26), 185000, 'CEDAR STUDIO', 'cedar-guidelines-paid', 0], [priorDay(28), -1200, 'MONTHLY SERVICE FEE', 'fee-prior', 1]] as const
  await statement('prior-statement', 'checking', 'operating-checking', prior, priorDay(1), priorEnd, OPENING, priorLines)
  await statement('prior-savings', 'savings', 'savings', prior, priorDay(1), priorEnd, 0, [])
  tasks(prior, () => true, i => ['Statement matched line by line.', 'Both paid in full; nothing overdue.', 'Brightline invoice attached; rent per lease.', 'No accruals this month.'][i], i => i === 3 ? MORGAN : TAYLOR, i => `${day(2 + (i >> 1))}T1${4 + i}:00:00.000Z`)

  // Last month: open, with a statement to reconcile and drafts to review.
  for (const [key, customer, ref, description, amount, date, status] of [
    ['cedar-site', 'cedar', '1041', 'Website refresh', 240000, 1, 'issued'], ['northstar-retainer', 'northstar', '1042', 'Quarterly retainer', 385000, 2, 'issued'],
    ['willow-brand', 'willow', '1043', 'Brand workshop', 140000, 5, 'issued'], ['cedar-social', 'cedar', '1044', 'Social templates', 120000, 12, 'issued'],
    ['cafe-menu', 'harbor-lights', '1045', 'Seasonal menu redesign', 95000, 20, 'approved'], ['willow-followup', 'willow', '1046', 'Brand rollout planning', 175000, 24, 'draft'],
  ] as const) invoice(key, customer, ref, description, amount, day(date), status)
  for (const [key, vendor, ref, description, code, amount] of [['software', 'brightline', 'INV-88', 'Design software subscriptions', '6200', 64000], ['rent', 'harbor', 'R-09', 'Studio rent', '6100', 130000], ['supplies', 'paper', 'PP-204', 'Workshop paper and supplies', '6300', 18650]] as const)
    bill(key, vendor, ref, description, code, amount, day(1), end)
  for (const [key, contact, target, date, amount, direction] of [['cedar-paid', 'cedar', 'cedar-site', 3, 240000, 'received'], ['willow-paid', 'willow', 'willow-brand', 18, 140000, 'received'], ['rent-paid', 'harbor', 'rent', 24, 130000, 'paid']] as const)
    payment(key, contact, target, day(date), amount, direction)
  entry('accrual', today, 'Monthly bookkeeping fee on business card', 'manual', id('accrual'), [['6500', 35000, 0], ['2100', 0, 35000]], false)
  const priorClosing = OPENING + priorLines.reduce((s, l) => s + l[1], 0)
  const statementLines = [[day(3), 240000, 'CEDAR STUDIO'], [day(8), -64000, 'BRIGHTLINE SOFTWARE'], [day(18), 140000, 'WILLOW SERVICES'], [day(24), -130000, 'CHECK 2052 HARBOR RENT'], [day(28), -1200, 'MONTHLY SERVICE FEE']] as const
  await statement('statement', 'checking', 'operating-checking', month, start, end, priorClosing, statementLines)
  for (const taskMonth of [month, today.slice(0, 7)]) tasks(taskMonth, i => i === 1, () => 'Customer balances checked against invoices.', () => ownerEmail, () => at)
  r.add('pt_agents', { id: id('agent'), name: 'Juniper books assistant', token_hash: await sha256('demo-agent-with-no-issued-token'), created_by: ownerEmail, created_at: at, revision: id('agent') })
  for (const key of ['northstar-retainer', 'cafe-menu'])
    r.add('pt_approvals', { id: id(`approval-${key}`), subject_kind: 'invoice', subject_id: id(key), subject_revision: id(key), action: 'approve', decision: 'approved', actor_email: MORGAN, note: 'Scope and tax treatment reviewed.', at })
  r.add('pt_notes', { id: id('variance'), kind: 'variance', period: month, body: 'Northstar retainer is the largest open receivable. Follow up before the next close.', evidence: '[]', approved_by: ownerEmail, approved_at: at })
  for (const [i, when, action, kind, subject] of [[1, `${openingDay}T10:00:00.000Z`, 'chart.start', 'chart', 'service-business'], [2, `${day(2)}T11:00:00.000Z`, 'invoice.issue', 'invoice', id('northstar-retainer')], [3, `${today}T09:00:00.000Z`, 'statement.import', 'statement', id('statement')]] as const)
    r.add('pt_audit', { id: id(`audit-${i}`), at: when, actor_email: ownerEmail, actor_kind: 'person', action, subject_kind: kind, subject_id: subject, detail: '{}' })
  await r.save()

  await closeMonth(env.DB, { id: owner.id, email: ownerEmail, name: OWNER_NAME }, prior, {
    matches: priorLines.map(([, , , key, line], i) => [id(`prior-statement-line-${i}`), id(`line-${key}-${line}`)]),
    statements: [id('prior-statement'), id('prior-savings')],
    note: 'Reviewed with Morgan Lee CPA.',
    reconciledAt: `${day(3)}T15:40:00.000Z`, lockedAt: `${day(4)}T16:20:00.000Z`,
  })

  // This month's feed lines arrive after the open statement, as a sync brings them.
  await seedFeeds(env.DB, { ownerEmail, now, checkingBalance: priorClosing + statementLines.reduce((s, l) => s + l[1], 0) })

  // An agent's proposal waits for a person; added after the close, which requires none waiting.
  const later = records(env.DB)
  later.add('pt_proposals', { id: id('proposal'), agent_id: id('agent'), kind: 'variance-note', summary: 'Explain the Northstar retainer in service revenue', payload: JSON.stringify({ period: month, body: 'The quarterly Northstar retainer contributed $3,850 of the $8,850 invoiced this month. It remains open for follow-up; this explanation changes no ledger figures.', citations: [id('journal-northstar-retainer')] }), refs: JSON.stringify([{ kind: 'journal', id: id('journal-northstar-retainer'), revision: id('journal-northstar-retainer') }]), status: 'proposed', created_at: at, revision: id('proposal') })
  await later.save()
}
