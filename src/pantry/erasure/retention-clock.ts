// Resolve evidence against actual posted books, including later corrections.
import { all, guard, type Sql } from '../db'
import type { Data } from '../core'

const SOURCES: Record<string, string[]> = {
  pt_journal_entries: ['id', 'entry_date', 'status', 'reverses_id', 'document_id'],
  pt_journal_lines: ['id', 'entry_id', 'contact_id'],
  pt_invoices: ['id', 'customer_id', 'journal_id', 'credit_for', 'exemption_evidence'],
  pt_bills: ['id', 'vendor_id', 'journal_id'],
  pt_payments: ['id', 'contact_id', 'journal_id'],
  pt_vendor_credits: ['id', 'vendor_id', 'journal_id'],
  pt_allocations: ['id', 'source_kind', 'source_id', 'target_kind', 'target_id'],
  pt_reclassifications: ['id', 'original_entry_id', 'correcting_entry_id'],
  pt_recognition_schedules: ['id', 'source_journal_id'],
  pt_recognition_runs: ['schedule_id', 'revision', 'occurrence', 'journal_id'],
  pt_match_bank_lines: ['match_id', 'bank_line_id'],
  pt_match_postings: ['match_id', 'journal_line_id'],
  pt_bank_lines: ['id', 'statement_id'],
  pt_statements: ['id', 'document_id'],
  pt_receipts: ['id', 'document_id', 'file_document_id', 'vendor_id', 'target_kind', 'target_id', 'linked_kind', 'linked_id'],
  pt_exemption_certificates: ['id', 'customer_id', 'document_id'],
  pt_xero_attachments: ['id', 'item_id', 'item_kind', 'document_id'],
  pt_documents: ['id', 'linked_kind', 'linked_id', 'requested_linked_kind', 'requested_linked_id', 'duplicate_of', 'erased_at'],
}

function snapshotSql(table: string, columns: string[]) {
  return `SELECT json_group_array(json_array(${columns.join(',')})) AS snapshot FROM (SELECT ${columns.join(',')} FROM ${table} ORDER BY ${columns.join(',')})`
}

export async function supportingBooks(db: D1Database) {
  const entries = Object.entries(SOURCES)
  const loaded = await Promise.all(entries.map(async ([table, columns]) => {
    const rows = await all(db, `SELECT ${columns.join(',')} FROM ${table} ORDER BY ${columns.join(',')}`)
    return [table, rows] as const
  }))
  const tables = Object.fromEntries(loaded) as Record<string, Data[]>
  // Capture and assert the same graph, rather than trusting a clock read before a write.
  const guards: Sql[] = entries.map(([table, columns]) => {
    const rows = tables[table]
    return guard(`(${snapshotSql(table, columns).replace(' AS snapshot', '')}) = ?`, JSON.stringify(rows.map(r => columns.map(c => r[c] ?? null))))
  })
  const records = new Map<string, Set<string>>(), contacts = new Map<string, Set<string>>(), documents = new Map<string, Set<string>>()
  const edges = new Map<string, Set<string>>(), directContacts = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, key: unknown, value: unknown) => {
    if (key === null || key === undefined || !value) return
    const k = String(key), values = map.get(k) ?? new Set<string>(); values.add(String(value)); map.set(k, values)
  }
  const copy = (map: Map<string, Set<string>>, key: unknown, values: Iterable<string>) => { for (const value of values) add(map, key, value) }
  const record = (kind: unknown, id: unknown) => records.get(`${kind === 'entry' ? 'journal' : kind}:${id}`) ?? new Set<string>()
  for (const e of tables.pt_journal_entries) { add(records, `journal:${e.id}`, e.id); add(edges, e.reverses_id, e.id); add(documents, e.document_id, e.id) }
  for (const l of tables.pt_journal_lines) add(contacts, l.contact_id, l.entry_id)
  for (const [table, kind, contact] of [['pt_invoices', 'invoice', 'customer_id'], ['pt_bills', 'bill', 'vendor_id'], ['pt_payments', 'payment', 'contact_id'], ['pt_vendor_credits', 'vendor-credit', 'vendor_id']]) {
    for (const r of tables[table]) { add(records, `${kind}:${r.id}`, r.journal_id); add(contacts, r[contact], r.journal_id) }
  }
  for (const r of tables.pt_reclassifications) add(edges, r.original_entry_id, r.correcting_entry_id)
  const schedules = new Map(tables.pt_recognition_schedules.map(r => [r.id, r.source_journal_id]))
  for (const r of tables.pt_recognition_runs) add(edges, schedules.get(r.schedule_id), r.journal_id)
  for (const i of tables.pt_invoices) if (i.credit_for) for (const root of record('invoice', i.credit_for)) add(edges, root, i.journal_id)
  for (const a of tables.pt_allocations) {
    const sourceKind = a.source_kind === 'payment' ? 'payment' : a.target_kind === 'bill' ? 'vendor-credit' : 'invoice'
    for (const root of record(a.target_kind, a.target_id)) copy(edges, root, record(sourceKind, a.source_id))
  }
  const lines = new Map(tables.pt_journal_lines.map(l => [l.id, l.entry_id]))
  const matches = new Map<string, Set<string>>()
  for (const m of tables.pt_match_postings) add(matches, m.match_id, lines.get(m.journal_line_id))
  for (const m of tables.pt_match_bank_lines) copy(records, `bankline:${m.bank_line_id}`, matches.get(m.match_id) ?? [])
  for (const b of tables.pt_bank_lines) copy(records, `statement:${b.statement_id}`, record('bankline', b.id))
  for (const s of tables.pt_statements) copy(documents, s.document_id, record('statement', s.id))
  for (const d of tables.pt_documents) {
    copy(documents, d.id, record(d.linked_kind, d.linked_id))
    copy(documents, d.id, record(d.requested_linked_kind, d.requested_linked_id))
  }
  for (const r of tables.pt_receipts) {
    for (const id of [r.document_id, r.file_document_id]) {
      copy(documents, id, record(r.target_kind, r.target_id)); copy(documents, id, record(r.linked_kind, r.linked_id))
      add(directContacts, id, r.vendor_id)
    }
  }
  for (const r of tables.pt_xero_attachments) copy(documents, r.document_id, record(r.item_kind, r.item_id))
  for (const c of tables.pt_exemption_certificates) {
    add(directContacts, c.document_id, c.customer_id)
    for (const i of tables.pt_invoices) {
      if (!i.exemption_evidence) continue
      const evidence = JSON.parse(i.exemption_evidence)
      if (evidence.id === c.id || evidence.documentId === c.document_id) copy(documents, c.document_id, record('invoice', i.id))
    }
  }
  // Duplicate evidence may be stored once and cited through either document.
  let changed = true
  while (changed) {
    changed = false
    for (const d of tables.pt_documents) if (d.duplicate_of) {
      const both = new Set([...(documents.get(d.id) ?? []), ...(documents.get(d.duplicate_of) ?? [])])
      for (const id of [d.id, d.duplicate_of]) if ((documents.get(id)?.size ?? 0) !== both.size) { documents.set(id, new Set(both)); changed = true }
    }
  }
  const byId = new Map(tables.pt_journal_entries.map(e => [e.id, e]))
  const closure = (seeds: Iterable<string>) => {
    const found = new Set(seeds), queue = [...found]
    for (let n = 0; n < queue.length; n++) for (const id of edges.get(queue[n]) ?? []) if (!found.has(id)) { found.add(id); queue.push(id) }
    return found
  }
  const clock = (seeds: Iterable<string>) => {
    const dates = [...closure(seeds)].map(id => byId.get(id)).filter(e => e?.status === 'posted').map(e => e!.entry_date as string)
    return dates.length ? dates.sort().at(-1)! : null
  }
  return { guards, documents, directContacts, contacts, closure, clock, record }
}
