// Personal copies outside the subject row. Financial keys, amounts, hashes and
// posted journal text remain intact; retained original evidence has its own clock.
import { all, changed, guard, q, type Sql } from '../db'
import type { Data } from '../core'
import { scrub } from './personal'
import { retentionItems } from './retention-items'
import { estimateCopies } from '../estimates/erasure'
import { siblingCopies } from '../estimates/siblings/erasure'
import { timeCopies } from './time'
import { supportingBooks } from './retention-clock'

type Input = { id: string; member: boolean; memberEmail?: string; posted: boolean; values: string[]; marker: string; erasureId: string; at: string }
type Column = { name: string; pk: number }
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`
const FIELDS: Record<string, string[]> = {
  pt_assets:['name'],pt_asset_tax:['note'],pt_asset_settings:['safe_harbor'],
  pt_learned_recognition:['evidence','backtest'],pt_agent_permissions:['name','payee','owner_email'],pt_agent_actions:['permission_snapshot'],
  pt_tax_deadlines:['label'],
  pt_tax_reminder_batches:['items','outcomes'],
  pt_collection_sends:['snapshot'],
  pt_collection_cases:['subject','body','recipient','evidence','reply_note'],
  pt_deliveries: ['recipient', 'subject', 'detail'],
  pt_payment_notices: ['recipient','subject','detail'],
  pt_stripe_payments: ['payer_email','method_brand','method_bank','return_reason'],
  pt_customer_refunds: ['reason'],
  pt_estimate_deliveries: ['recipient','detail'],
  pt_customer_deposits: ['reference','memo'],
  pt_questions: ['title', 'question', 'why', 'facts', 'choices', 'pending', 'answer', 'emailed_to', 'email_detail'],
  pt_question_messages: ['body'],
  pt_receipts: ['sender', 'subject', 'read_note', 'read_vendor', 'vendor', 'vendor_key', 'read_vendor_details', 'read_draft_fields', 'read_match_fields', 'duplicate_reason'],
  pt_capture_drafts: ['payload'],
  pt_notes: ['body', 'evidence'],
  pt_proposals: ['summary', 'payload', 'refs', 'decision_note'],
  pt_history_lines: ['name', 'memo', 'split'],
  pt_invoices: ['void_reason', 'memo', 'document_template', 'document_values', 'self_approval'],
  pt_bills: ['memo', 'scheduled_note'],
  pt_payments: ['reference', 'memo'],
  pt_recurring: ['name', 'memo', 'lines'],
  pt_recurring_bills: ['name', 'lines'],
  pt_recurring_prices: ['lines'],
  pt_recurring_journals: ['name', 'memo', 'lines'],
  pt_bank_rules: ['name', 'payee', 'description_contains', 'splits', 'memo'],
  pt_receipt_rules: ['vendor'],
  pt_bank_lines: ['description', 'reference', 'payee', 'feed_snapshot', 'excluded_reason'],
  pt_feed_history: ['description', 'details', 'reason', 'candidates'],
  pt_matches: ['note'],
  pt_reconciliations: ['snapshot'],
  pt_close_tasks: ['note'],
  pt_reopen_requests: ['reason'],
  pt_review_notes: ['note'],
  pt_receipt_waivers: ['reason'],
  pt_move_in_reports: ['left_out'],
  pt_custom_reports: ['definition'],
  pt_management_packages: ['definition'],
  pt_invoice_templates: ['settings'],
  pt_capture_approval_reminders: ['recipient', 'email_detail'],
  pt_bill_approval_reminders: ['recipient', 'email_detail'],
  pt_feed_alerts: ['message', 'email_detail'],
  pt_nexus_alerts: ['recipients', 'email_detail'],
  pt_nexus_decisions: ['note'],
  pt_check_flags: ['title', 'detail', 'setting', 'lines', 'dismissed_reason'],
  pt_contractor_tax: ['address', 'city', 'state', 'zip'],
}
const JSON_FIELDS = new Set(['items','outcomes','backtest','permission_snapshot','facts', 'choices', 'pending', 'read_vendor_details', 'read_draft_fields', 'read_match_fields', 'payload', 'refs', 'evidence', 'document_template', 'document_values', 'self_approval', 'lines', 'splits', 'feed_snapshot', 'details', 'candidates', 'snapshot', 'left_out', 'definition', 'settings', 'recipients', 'setting'])
// Their scoped trigger exceptions and metadata are owned by the caller. Never
// attempt a generic update through an immutable accounting/history door.
const CALLER_OWNED = new Set(['pt_contacts', 'pt_members', 'pt_audit', 'pt_approvals', 'pt_journal_entries', 'pt_journal_lines', 'pt_invoice_documents', 'pt_documents', 'pt_document_parts', 'pt_voided_reconciliations', 'pt_reconciliation_undos', 'pt_line_suggestion_decisions', 'pt_time_entries', 'pt_time_projects','pt_estimates','pt_estimate_documents','pt_estimate_sibling_previews','pt_estimate_sibling_links','pt_estimate_sibling_attempts'])

function replacement(value: unknown, column: string, input: Input): unknown {
  if (typeof value !== 'string') return value
  if (JSON_FIELDS.has(column) && value.trim()) {
    // Some historical narrative columns admit both JSON and plain text. Keep
    // either representation, numeric tokens and bookkeeping keys intact.
    try { JSON.parse(value) } catch { return scrub(value, input.values, input.marker) }
    return value.replace(/"(?:[^"\\]|\\.)*"/g, (token: string, offset: number) => {
      if (/^\s*:/.test(value.slice(offset + token.length))) return token
      const before: string = JSON.parse(token), after = scrub(before, input.values, input.marker)
      return before === after ? token : JSON.stringify(after)
    })
  }
  return scrub(value, input.values, input.marker)
}

export async function eraseCopies(db: D1Database, input: Input) {
  const statements: Sql[] = [], counts: Record<string, Data> = {}, removed: { table: string; key: Record<string, unknown> }[] = []
  const tables = await all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'pt_*' ORDER BY name")
  const schema = new Map<string, Column[]>()
  const receiptDocuments = new Set<string>(), affectedRecordIds = new Set<string>()
  await Promise.all(tables.map(async t => { schema.set(t.name, await all<Column>(db, `PRAGMA table_info(${quote(t.name)})`)) }))
  const note = (table: string, field: string, n: number) => { counts[table] ??= {}; counts[table][field] = (counts[table][field] ?? 0) + n }
  const update = (table: string, row: Data, set: Data) => {
    const keys = schema.get(table)!.filter(c => c.pk).map(c => c.name)
    const fields = Object.keys(set).filter(k => set[k] !== row[k])
    if (!fields.length) return
    if (row.id) affectedRecordIds.add(row.id)
    const before = [...new Set([...keys, ...fields])]
    if(table==='pt_tax_reminder_batches') statements.push(q("INSERT INTO pt_erasure_scope(erasure_id,table_name,row_id,operation) VALUES(?,'pt_tax_reminder_batches',?,'redact')",input.erasureId,row.id))
    statements.push(q(`UPDATE ${quote(table)} SET ${fields.map(k => `${quote(k)}=?`).join(',')} WHERE ${before.map(k => `${quote(k)} IS ?`).join(' AND ')}`, ...fields.map(k => set[k]), ...before.map(k => row[k])), changed())
    note(table, 'rowsReplaced', 1); note(table, 'fieldsReplaced', fields.length)
  }

  for (const { name: table } of tables) {
    if (CALLER_OWNED.has(table) || table.startsWith('pt_erasure_') || table.startsWith('pt_retained_')) continue
    if (table === 'pt_contractor_tax' && !input.member && !input.posted) continue // caller removes it with the unposted contact
    const columns = schema.get(table)!, names = new Set(columns.map(c => c.name)), keys = columns.filter(c => c.pk).map(c => c.name)
    const foreign = input.member ? await all<{ from: string; table: string }>(db, `PRAGMA foreign_key_list(${quote(table)})`) : []
    // *_by sometimes names an opaque invoice/entry id, rather than a person.
    const identity = input.member ? columns.filter(c => !c.pk && /(_by$|^(author|reviewer|assignee|actor_email)$)/.test(c.name) && !foreign.some(f => f.from === c.name && !['pt_members', 'oa_operators'].includes(f.table))).map(c => c.name) : []
    const fields = [...new Set([...(FIELDS[table] ?? []).filter(c => names.has(c)), ...identity])]
    if (!fields.length || !keys.length) continue
    const selected = [...new Set([...keys, ...fields, ...(names.has('revision') ? ['revision'] : []), ...(table==='pt_tax_reminder_batches' ? ['status'] : []), ...(table === 'pt_receipts' ? ['document_id', 'file_document_id', 'vendor_id'] : []), ...(names.has('erased_at') ? ['erased_at'] : [])])]
    for (const row of await all(db, `SELECT ${selected.map(quote).join(',')} FROM ${quote(table)}`)) {
      if (row.erased_at) continue
      const set: Data = {}
      for (const field of fields) {
        if (identity.includes(field)) { if (row[field] === input.id) set[field] = input.marker }
        else set[field] = replacement(row[field], field, input)
      }
      if (table === 'pt_contractor_tax' && !input.member && row.contact_id === input.id) for (const field of ['address', 'city', 'state', 'zip']) set[field] = input.marker
      if (['pt_deliveries','pt_payment_notices'].includes(table) && set.recipient !== row.recipient) set.recipient = `${input.marker}:${row.id}`
      if(table==='pt_customer_deposits'&&set.reference!==row.reference)set.reference=`${set.reference}:${row.id}`
      if (table === 'pt_bank_rules' && set.name !== row.name) set.name = `${set.name}:${row.id}`
      if(table==='pt_agent_permissions'&&Object.keys(set).some(k=>set[k]!==row[k]))set.active=0
      if(table==='pt_tax_reminder_batches' && ['draft','sending'].includes(row.status) && Object.keys(set).some(k=>set[k]!==row[k]))set.status='cancelled'
      if (Object.keys(set).some(k => set[k] !== row[k]) && names.has('revision')) set.revision = crypto.randomUUID()
      if (table === 'pt_receipts' && (Object.keys(set).some(k => set[k] !== row[k]) || (!input.member && row.vendor_id === input.id))) {
        for (const id of [row.document_id, row.file_document_id]) if (id) receiptDocuments.add(id)
      }
      update(table, row, set)
    }
  }

  // Detach optional classification pointers before a transaction-free contact
  // is removed. Opaque financial links are preserved for posted counterparties.
  if (!input.member && !input.posted) for (const [table, column] of [['pt_receipts', 'vendor_id'], ['pt_bank_rules', 'contact_id'], ['pt_capture_approval_rules', 'vendor_id']] as const) {
    const n = (await all(db, `SELECT count(*) AS n FROM ${table} WHERE ${column}=?`, input.id))[0].n
    statements.push(q(`UPDATE ${table} SET ${column}=NULL WHERE ${column}=?`, input.id)); note(table, 'linksRemoved', n)
  }
  // Lookup keys may themselves be an email or normalized personal alias. They
  // are no longer useful for an erased counterparty and cannot be renamed.
  for (const [table, subject, text] of [['pt_vendor_aliases', 'vendor_id', 'alias'], ['pt_integration_contacts', 'contact_id', 'external_id']] as const) {
    if (!input.member && !input.posted) continue // caller already removes these rows
    const keys = schema.get(table)!.filter(c => c.pk).map(c => c.name)
    for (const row of await all(db, `SELECT * FROM ${table}`)) {
      const matches = input.member ? [...keys, text].some(k => typeof row[k] === 'string' && scrub(row[k], input.values, input.marker) !== row[k]) : row[subject] === input.id
      if (!matches) continue
      statements.push(q(`DELETE FROM ${table} WHERE ${keys.map(k => `${quote(k)} IS ?`).join(' AND ')}`, ...keys.map(k => row[k])), changed())
      removed.push({ table, key: Object.fromEntries(keys.map(k => [k, row[k]])) }); note(table, 'rowsRemoved', 1)
    }
  }

  if (receiptDocuments.size) {
    for (const part of await all(db, 'SELECT p.document_id,s.document_id AS original_id FROM pt_capture_parts p JOIN pt_capture_sources s ON s.id=p.source_id'))
      if (receiptDocuments.has(part.document_id)) receiptDocuments.add(part.original_id)
  }
  const books = await supportingBooks(db), retained = input.member ? [] : await retentionItems(db, input.id)
  const keep = new Set(retained.filter(i => i.table === 'pt_documents').map(i => i.id))
  const metadata = ['name', 'note', 'capture_vendor', 'capture_invoice_number', 'duplicate_reason']
  const columns = ['id', 'sha256', 'size', 'erased_at', 'linked_kind', 'linked_id', 'uploaded_by', ...metadata]
  const documents = await all(db, `SELECT ${columns.join(',')} FROM pt_documents`)
  // Direct financial records also identify unposted evidence, for which there
  // is no retention clock yet.
  const linked = new Set<string>()
  if (!input.member) for (const [table, column, kind] of [['pt_invoices', 'customer_id', 'invoice'], ['pt_bills', 'vendor_id', 'bill'], ['pt_payments', 'contact_id', 'payment']] as const) {
    for (const row of await all(db, `SELECT id FROM ${table} WHERE ${column}=?`, input.id)) linked.add(`${kind}:${row.id}`)
  }
  const affectedHashes = new Set(documents.filter(row => receiptDocuments.has(row.id) || metadata.some(k => replacement(row[k], k, input) !== row[k]) || (!input.member && (books.directContacts.get(row.id)?.has(input.id) || linked.has(`${row.linked_kind}:${row.linked_id}`)))).map(row => row.sha256))
  let graphGuarded = false
  for (const row of documents) {
    const changedText = metadata.some(k => replacement(row[k], k, input) !== row[k])
    const belongs = affectedHashes.has(row.sha256)
    const supporting = keep.has(row.id) || Boolean(books.clock(books.documents.get(row.id) ?? []))
    // Supporting bytes and presentation remain exact until confirmed expiry.
    if ((!changedText && !belongs) || row.erased_at || supporting) {
      if (!row.erased_at && input.member && row.uploaded_by === input.id) update('pt_documents', row, { uploaded_by: input.marker })
      continue
    }
    if (!graphGuarded) { statements.unshift(...books.guards); graphGuarded = true }
    affectedRecordIds.add(row.id)
    const parts = await all(db, 'SELECT seq,length(content) AS bytes FROM pt_document_parts WHERE document_id=? ORDER BY seq', row.id)
    statements.push(guard('(SELECT count(*) FROM pt_document_parts WHERE document_id=?)=?', row.id, parts.length),
      q("INSERT INTO pt_erasure_scope VALUES (?,'pt_documents',?,'expire')", input.erasureId, row.id),
      q('DELETE FROM pt_document_parts WHERE document_id=?', row.id),
      q(`UPDATE pt_documents SET content=X'',name=?,note=?,capture_vendor=NULL,capture_invoice_number=NULL,duplicate_reason=?,erased_at=?,uploaded_by=? WHERE id=? AND sha256=? AND erased_at IS NULL`, input.marker, input.marker, `Erasure ${input.erasureId}`, input.at, input.member && row.uploaded_by === input.id ? input.marker : row.uploaded_by, row.id, row.sha256), changed())
    note('pt_documents', 'rowsReplaced', 1); note('pt_documents', 'bytesRemoved', row.size)
    note('pt_document_parts', 'rowsRemoved', parts.length)
    for (const part of parts) removed.push({ table: 'pt_document_parts', key: { document_id: row.id, seq: part.seq } })
  }
  const est=await estimateCopies(db,input)
  const sibling = await siblingCopies(db,input)
  statements.push(...sibling.statements)
  removed.push(...sibling.removed)
  for(const [table,values] of Object.entries(sibling.counts))counts[table]={...counts[table],...values}
  for(const id of sibling.affectedRecordIds)affectedRecordIds.add(id)
  statements.push(...est.statements)
  for(const [table,values] of Object.entries(est.counts))counts[table]={...counts[table],...values}
  for(const id of est.affectedRecordIds)affectedRecordIds.add(id)
  const time = await timeCopies(db, input)
  statements.push(...time.statements)
  for (const [table, values] of Object.entries(time.counts)) counts[table] = { ...counts[table], ...values }
  for (const id of time.affectedRecordIds) affectedRecordIds.add(id)
  return { statements, counts, removed, affectedRecordIds: [...affectedRecordIds] }
}
