// A shared provenance reader for financial figures. Cash rows use the same
// settlement allocation and keys as the general ledger, never inferred totals.
import type { Data } from './core'
import { all } from './db'
import { cashLines, sameOnCash, type Basis } from './basis'
import { settlementMemo } from './reports'
import { attachments, bankMatches, recordLabels, recordOf, type RecordRef } from './records'

export const FIRST_DAY = '0000-01-01'
export type SourceScope = { accountId?: string; types: string[]; from: string; to: string; sign: 1 | -1 }
export async function reportSourceRows(db: D1Database, s: SourceScope, basis: Basis): Promise<Data[]> {
  const accounts = new Map((await all(db, 'SELECT id, code, name, type FROM pt_accounts')).map(a => [a.id, a]))
  const inScope = (accountId: string) => s.accountId ? accountId === s.accountId : s.types.includes(accounts.get(accountId)?.type)
  const filter = s.accountId ? 'l.account_id = ?' : `a.type IN (${s.types.map(() => '?').join(', ')})`
  const posted = await all(db, `SELECT l.id AS line_id, l.account_id, l.contact_id, l.debit_cents, l.credit_cents, l.memo, e.id AS entry_id, e.number, e.entry_date, e.memo AS entry_memo, e.source_kind, e.source_id, e.document_id, e.reverses_id
    FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND ${filter} ${basis === 'cash' ? `AND ${sameOnCash()}` : ''}
    ORDER BY e.entry_date, e.number, l.line_no`, s.from, s.to, ...(s.accountId ? [s.accountId] : s.types))
  const labels = await recordLabels(db), docs = await attachments(db), bank = await bankMatches(db)
  const account = (id: string) => { const a = accounts.get(id)!; return { id: a.id, code: a.code, name: a.name } }
  const rows: Data[] = posted.map(l => {
    const record = recordOf(l, labels)
    return { contactId: l.contact_id ?? null, invoiceContactId: labels.invoiceContact(l.reverses_id ?? l.entry_id), sourceContactId: labels.sourceContact(l.reverses_id ?? l.entry_id), key: l.line_id, date: l.entry_date, account: account(l.account_id), amount: s.sign * (l.debit_cents - l.credit_cents), debit: l.debit_cents, credit: l.credit_cents,
      description: l.entry_memo, lineMemo: l.memo, entry: { id: l.entry_id, number: l.number }, record, settlement: null,
      documents: docs.forRecords([record, { kind: 'entry', id: l.entry_id }], l.document_id), bank: bank.forLine(l.line_id, l.entry_id, record) }
  })
  if (basis === 'cash') for (const [i, c] of (await cashLines(db, s.from, s.to)).entries()) {
    if (!inScope(c.accountId)) continue
    const record: RecordRef = { kind: c.docKind === 'bill' ? 'bill' : 'invoice', id: c.docId, label: labels.label(c.docKind === 'bill' ? 'bill' : 'invoice', c.docId) }
    const by: RecordRef | null = c.settlement.paymentId ? { kind: 'payment', id: c.settlement.paymentId, label: labels.label('payment', c.settlement.paymentId) }
      : c.settlement.kind === 'credit' ? { kind: 'invoice', id: c.settlement.creditId!, label: labels.label('invoice', c.settlement.creditId!) }
      : { kind: 'invoice', id: c.settlement.appliedToId!, label: labels.label('invoice', c.settlement.appliedToId!) }
    rows.push({ contactId: c.contactId, invoiceContactId: null, sourceContactId: c.contactId, key: `cash-${i}`, date: c.date, account: account(c.accountId), amount: s.sign * c.net, debit: Math.max(c.net, 0), credit: Math.max(-c.net, 0),
      description: settlementMemo(c), lineMemo: c.description, entry: { id: c.docJournalId, number: null }, record,
      settlement: { kind: c.settlement.kind, by, share: `${(c.settledAfter / 100).toFixed(2)} of ${(c.docTotal / 100).toFixed(2)} settled` },
      documents: docs.forRecords([record, { kind: 'entry', id: c.docJournalId }, ...(by ? [by] : [])]), bank: by?.kind === 'payment' ? bank.forPayment(by.id) : [] })
  }
  rows.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0)
  return rows
}
