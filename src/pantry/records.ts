// The records behind report lines: what each posting came from, the documents
// attached to it and the bank statement lines it was matched to, and one view
// of any invoice, credit, bill, payment or journal entry with everything linked
// to it, so a figure can be followed down to its evidence and back.
import { requireThat, type Data } from './core'
import { all, one } from './db'
import { entry } from './journal'
import { invoice } from './invoices'
import { bill } from './payables'

export type RecordRef = { kind: 'invoice' | 'bill' | 'payment' | 'entry'; id: string; label?: string }

/** Labels for every record a report line can name. */
export async function recordLabels(db: D1Database) {
  const invoices = new Map((await all(db, 'SELECT i.id, i.kind, i.number, c.name FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id')).map(r => [r.id, `${r.kind === 'credit' ? 'Credit' : 'Invoice'} ${r.number} · ${r.name}`]))
  const bills = new Map((await all(db, 'SELECT b.id, b.reference, c.name FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id')).map(r => [r.id, `Bill ${r.reference} · ${r.name}`]))
  const payments = new Map((await all(db, 'SELECT p.id, p.direction, p.payment_date, c.name FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id')).map(r => [r.id, `Payment ${r.direction === 'received' ? 'from' : 'to'} ${r.name}`]))
  const entries = new Map((await all(db, "SELECT id, number FROM pt_journal_entries WHERE status = 'posted'")).map(r => [r.id, `Journal entry ${r.number}`]))
  const vendorCreditEntries = new Map((await all(db, 'SELECT id, journal_id FROM pt_vendor_credits')).map(v => [v.id, v.journal_id]))
  return { vendorCreditEntries, label: (kind: string, id: string) => (kind === 'invoice' ? invoices : kind === 'bill' ? bills : kind === 'payment' ? payments : entries).get(id) ?? 'Record' }
}

/** The record a posted entry came from. */
export function recordOf(e: Data, labels: Awaited<ReturnType<typeof recordLabels>>): RecordRef {
  const kind = labels.vendorCreditEntries.has(e.source_id) ? 'entry' : e.source_kind === 'invoice' || e.source_kind === 'credit' ? 'invoice' : e.source_kind === 'bill' ? 'bill' : e.source_kind === 'payment' ? 'payment' : 'entry'
  const id = kind === 'entry' ? e.entry_id : e.source_id!
  return { kind, id, label: labels.label(kind, id) }
}

/** Documents by the record they are attached to. */
export async function attachments(db: D1Database) {
  const docs = await all(db, 'SELECT id, name, media_type, sha256, linked_kind, linked_id FROM pt_documents WHERE linked_kind IS NOT NULL')
  const byId = new Map((await all(db, 'SELECT id, name, media_type, sha256 FROM pt_documents')).map(d => [d.id, d]))
  const key = (kind: string, id: string) => `${kind === 'entry' ? 'journal' : kind}:${id}`
  const linked = new Map<string, Data[]>()
  for (const d of docs) linked.set(`${d.linked_kind}:${d.linked_id}`, [...(linked.get(`${d.linked_kind}:${d.linked_id}`) ?? []), d])
  return {
    forRecords(refs: RecordRef[], cited?: string | null) {
      const out = new Map<string, Data>()
      for (const r of refs) for (const d of linked.get(key(r.kind, r.id)) ?? []) out.set(d.id, { id: d.id, name: d.name, mediaType: d.media_type })
      if (cited && byId.has(cited)) out.set(cited, { id: cited, name: byId.get(cited)!.name, mediaType: byId.get(cited)!.media_type })
      return [...out.values()]
    },
  }
}

/** Statement lines matched to ledger postings, by posting and by payment. */
export async function bankMatches(db: D1Database) {
  const rows = await all(db, `SELECT mp.journal_line_id, jl.entry_id, b.id, b.posted_date, b.description, b.amount_cents, s.id AS statement_id, s.document_id, ba.name AS bank, r.completed_at AS reconciled_at
    FROM pt_match_postings mp JOIN pt_matches m ON m.id = mp.match_id AND m.status = 'approved' JOIN pt_match_bank_lines mb ON mb.match_id = m.id AND mb.active = 1
    JOIN pt_bank_lines b ON b.id = mb.bank_line_id JOIN pt_statements s ON s.id = b.statement_id JOIN pt_bank_accounts ba ON ba.id = b.bank_account_id JOIN pt_journal_lines jl ON jl.id = mp.journal_line_id
    LEFT JOIN pt_reconciliations r ON r.statement_id = s.id
    WHERE mp.active = 1 ORDER BY b.posted_date, b.id`)
  const paymentJournal = new Map((await all(db, 'SELECT id, journal_id FROM pt_payments')).map(p => [p.id, p.journal_id]))
  const allocated = await all(db, "SELECT target_kind, target_id, source_id FROM pt_allocations WHERE source_kind = 'payment'")
  const view = (r: Data) => ({ id: r.id, date: r.posted_date, description: r.description, amount: r.amount_cents, bank: r.bank, statementDocumentId: r.document_id, reconciled: !!r.reconciled_at })
  const unique = (list: Data[]) => [...new Map(list.map(r => [r.id, view(r)])).values()]
  const forEntry = (entryId: string | undefined) => unique(rows.filter(r => r.entry_id === entryId))
  const forPayment = (paymentId: string) => forEntry(paymentJournal.get(paymentId))
  return {
    forPayment,
    forEntry,
    /** A posting's own bank match; for an invoice or bill, the bank lines of the payments applied to it; otherwise the
     *  statement lines matched to its entry's bank posting (an expense filed from a bank line by a rule or by hand). */
    forLine(lineId: string, entryId: string, record: RecordRef) {
      const own = rows.filter(r => r.journal_line_id === lineId)
      if (own.length) return unique(own)
      if (record.kind !== 'invoice' && record.kind !== 'bill') return forEntry(entryId)
      return unique(allocated.filter(a => a.target_id === record.id).flatMap(a => rows.filter(r => r.entry_id === paymentJournal.get(a.source_id))))
    },
  }
}

const entryView = async (db: D1Database, id: string | null) => {
  if (!id) return null
  const e = await entry(db, id)
  return { id: e.id, number: e.number, date: e.entry_date, memo: e.memo, status: e.status, lines: e.lines.map((l: Data) => ({ account: `${l.account_code} · ${l.account_name}`, debit: l.debit_cents, credit: l.credit_cents, memo: l.memo })) }
}

/** One record with its lines, journal entries, linked records, documents and bank lines. */
export async function recordView(db: D1Database, kind: string, id: string) {
  const labels = await recordLabels(db), docs = await attachments(db), bank = await bankMatches(db)
  const ref = (k: RecordRef['kind'], i: string, note = ''): Data => ({ kind: k, id: i, label: labels.label(k, i), note })
  if (kind === 'invoice') {
    const i = await invoice(db, id)
    const taxNames = new Map((await all(db, 'SELECT id, name, state FROM pt_tax_codes')).map(t => [t.id, `${t.name}${t.state ? ` (${t.state})` : ''}`]))
    const applied = await all(db, `SELECT a.*, p.payment_date, p.reversal_id FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
      WHERE (a.target_kind = 'invoice' AND a.target_id = ?) OR (a.source_kind = 'credit' AND a.source_id = ?) ORDER BY a.allocation_date, a.created_at`, id, id)
    const links = applied.map(a => a.source_id === id ? ref('invoice', a.target_id, `${(a.amount_cents / 100).toFixed(2)} applied ${a.allocation_date}`)
      : ref(a.source_kind === 'credit' ? 'invoice' : 'payment', a.source_id, `${(a.amount_cents / 100).toFixed(2)} applied ${a.allocation_date}${a.reversal_id ? ' (payment reversed)' : ''}`))
    if (i.credit_for) links.unshift(ref('invoice', i.credit_for, 'Invoice this credit is for'))
    const payments = applied.filter(a => a.source_kind === 'payment').map(a => a.source_id)
    return { kind, id, title: labels.label('invoice', id), date: i.issue_date, status: i.status, total: i.total_cents, open: i.open_cents,
      lines: i.lines.map((l: Data) => ({ description: l.description, amount: l.amount_cents, tax: l.tax_cents, taxCode: l.tax_code === 'exempt' ? 'Exempt' : taxNames.get(l.tax_code) ?? '' })),
      entries: [await entryView(db, i.journal_id)].filter(Boolean), links,
      documents: docs.forRecords([{ kind: 'invoice', id }, ...(i.journal_id ? [{ kind: 'entry' as const, id: i.journal_id }] : []), ...payments.map(p => ({ kind: 'payment' as const, id: p }))]),
      bank: payments.flatMap(p => bank.forPayment(p)) }
  }
  if (kind === 'bill') {
    const b = await bill(db, id)
    const applied = await all(db, "SELECT a.*, p.reversal_id FROM pt_allocations a LEFT JOIN pt_payments p ON p.id = a.source_id AND a.source_kind = 'payment' WHERE a.target_kind = 'bill' AND a.target_id = ? ORDER BY a.allocation_date, a.created_at", id)
    return { kind, id, title: labels.label('bill', id), date: b.bill_date, status: b.status, total: b.total_cents, open: b.open_cents,
      lines: b.lines.map((l: Data) => ({ description: l.description, amount: l.amount_cents })),
      entries: [await entryView(db, b.journal_id)].filter(Boolean),
      links: applied.map(a => ref(a.source_kind === 'credit' ? 'entry' : 'payment', labels.vendorCreditEntries.get(a.source_id) ?? a.source_id, `${(a.amount_cents / 100).toFixed(2)} applied ${a.allocation_date}${a.reversal_id ? ' (payment reversed)' : ''}`)),
      documents: docs.forRecords([{ kind: 'bill', id }, ...(b.journal_id ? [{ kind: 'entry' as const, id: b.journal_id }] : []), ...applied.map(a => ({ kind: 'payment' as const, id: a.source_id }))]),
      evidenceWaived: b.evidence_waived, bank: applied.flatMap(a => bank.forPayment(a.source_id)) }
  }
  if (kind === 'payment') {
    const p = await one(db, 'SELECT p.*, b.name AS bank_name FROM pt_payments p JOIN pt_bank_accounts b ON b.id = p.bank_account_id WHERE p.id = ?', id)
    requireThat(p, 'Payment not found', 404)
    const applied = await all(db, "SELECT * FROM pt_allocations WHERE source_kind = 'payment' AND source_id = ? ORDER BY allocation_date, created_at", id)
    return { kind, id, title: labels.label('payment', id), date: p.payment_date, status: p.reversal_id ? 'reversed' : 'recorded', total: p.amount_cents, method: p.method, reference: p.reference, bankName: p.bank_name,
      lines: [], entries: [await entryView(db, p.journal_id), await entryView(db, p.reversal_id)].filter(Boolean),
      links: applied.map(a => ref(a.target_kind === 'bill' ? 'bill' : 'invoice', a.target_id, `${(a.amount_cents / 100).toFixed(2)} applied ${a.allocation_date}`)),
      documents: docs.forRecords([{ kind: 'payment', id }, { kind: 'entry', id: p.journal_id }]), bank: bank.forPayment(id) }
  }
  requireThat(kind === 'entry', 'Unknown record', 404)
  const e = await entry(db, id)
  const source = e.source_kind === 'reversal' ? ref('entry', e.source_id, 'The entry this reverses')
    : labels.vendorCreditEntries.has(e.source_id) ? null : ['invoice', 'credit'].includes(e.source_kind) ? ref('invoice', e.source_id, 'Source record') : e.source_kind === 'bill' ? ref('bill', e.source_id, 'Source record') : e.source_kind === 'payment' ? ref('payment', e.source_id, 'Source record') : null
  const links = [source, e.reversed_by_id ? ref('entry', e.reversed_by_id, 'Reversed by') : null].filter(Boolean)
  return { kind, id, title: labels.label('entry', id), date: e.entry_date, status: e.status, total: e.lines.reduce((s: number, l: Data) => s + l.debit_cents, 0),
    lines: [], entries: [await entryView(db, id)], links, documents: docs.forRecords([{ kind: 'entry', id }], e.document_id), bank: bank.forEntry(id) }
}
