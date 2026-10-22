import type { DimensionScope } from '../dimensions/scope'
import { type Data } from '../core'
import { all } from '../db'
import { ageing } from '../reports'
import type { LibraryReport } from './types'

/** Open documents are filtered by original document date, with balances as of to. */
export async function openItems(db: D1Database, kind: string, from: string, to: string, dimension?: DimensionScope): Promise<Partial<LibraryReport>> {
  const receivable = ['receivables-summary', 'open-invoices', 'customer-balances'].includes(kind)
  const report = await ageing(db, receivable ? 'receivable' : 'payable', to, dimension)
  const items = (report.items as Data[]).filter(i => i.doc_date >= from)
  if (kind.endsWith('-balances')) {
    // Control lines carry the contact, including unapplied payments and credits.
    const rows = await all(db, `SELECT c.id, c.name, SUM(l.debit_cents-l.credit_cents) AS net
      FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id JOIN pt_accounts a ON a.id=l.account_id
      JOIN pt_contacts c ON c.id=l.contact_id WHERE e.status='posted' AND e.entry_date <= ? AND a.subtype=? ${dimension?`AND l.${dimension.kind}_name=?`:''} GROUP BY c.id HAVING net <> 0 ORDER BY c.name`, to, receivable ? 'receivable' : 'payable',...(dimension?[dimension.value]:[]))
    return { note: 'Balances as of the end date include all earlier activity and unapplied payments and credits. The start date does not discard opening balances.',
      columns: [receivable ? 'Customer' : 'Vendor', 'Balance'], moneyColumns: [1], rows: rows.map(r => ({ id: r.id, cells: [r.name, (receivable ? 1 : -1) * Number(r.net)] })),
      totals: [{ label: 'Control account balance', amount: report.control?.balance ?? 0 }] }
  }
  const total = items.reduce((n, i) => n + i.open, 0)
  const note = `Documents dated within the inclusive range, still open as of ${to}. Unapplied money is shown separately on customer/vendor balances; full subledger ${report.subledger / 100} USD, control ${(report.control?.balance ?? 0) / 100} USD.`
  if (kind.endsWith('-summary')) {
    const grouped = new Map<string, Data>()
    for (const i of items) {
      const r = grouped.get(i.contact_id) ?? { id: i.contact_id, name: i.contact, buckets: report.buckets.map(() => 0), total: 0 }
      r.buckets[report.buckets.indexOf(i.bucket)] += i.open; r.total += i.open; grouped.set(i.contact_id, r)
    }
    return { note, columns: [receivable ? 'Customer' : 'Vendor', ...report.buckets, 'Open'], moneyColumns: [1, 2, 3, 4, 5, 6],
      rows: [...grouped.values()].map(r => ({ id: r.id, cells: [r.name, ...r.buckets, r.total] })), totals: [{ label: 'Open documents', amount: total }] }
  }
  return { note, columns: ['Date', 'Reference', receivable ? 'Customer' : 'Vendor', 'Due', 'Bucket', 'Original', 'Open'], moneyColumns: [5, 6],
    rows: items.map(i => ({ id: i.id, cells: [i.doc_date, i.ref, i.contact, i.due_date, i.bucket, i.total_cents, i.open], record: `${receivable ? 'invoice' : 'bill'}:${i.id}` })), totals: [{ label: 'Open documents', amount: total }] }
}
