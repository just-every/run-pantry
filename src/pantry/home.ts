// The Overview's one read (U11): its figures, and the first rows of every job waiting for
// a person, counted the same way as the shell's tabs.
import { all } from './db'
import { entity } from './settings'
import { feedHealth } from './feeds/health'
import { parse, withThreads } from './questions/store'
import { queueCounts } from './views'
import { bankMovements, billsToApprove, booksCurrent, cashAcrossAccounts, missingSources, overdueBalances } from './dashboard'

const ROWS = 3

export async function home(db: D1Database, asOf: string) {
  const business = await entity(db), from = asOf.slice(0, 8) + '01', counts = await queueCounts(db)
  const cash = await cashAcrossAccounts(db), movements = await bankMovements(db, from, asOf)
  const open = await all(db, "SELECT * FROM pt_questions WHERE status IN ('open', 'confirm') ORDER BY record_date, asked_at, id")
  // The same first question as Questions from Pantry: an answer waiting for a yes, else the oldest still open.
  const first = open.find(q => q.status === 'confirm') ?? open[0]
  return {
    asOf, from,
    figures: { cash: { total: cash.total, observed: cash.observed, expected: cash.expected }, moneyIn: movements?.moneyIn ?? 0, moneyOut: movements?.moneyOut ?? 0, ...await booksCurrent(db, asOf) },
    questions: { total: open.length, first: first ? (await withThreads(db, [parse(first)]))[0] : null, next: open.filter(q => q !== first).slice(0, ROWS).map(q => ({ id: q.id, title: q.title })) },
    feedAlerts: await feedHealth(db),
    unmatchedLines: counts.unmatchedLines,
    invoiceDrafts: { total: counts.invoiceDrafts, rows: await all(db, `SELECT i.id, i.number, i.kind, i.status, i.total_cents, c.name AS customer FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id
      WHERE i.status IN ('draft', 'approved') ORDER BY i.created_at DESC, i.number DESC LIMIT ${ROWS}`) },
    billsToApprove: await billsToApprove(db),
    receipts: { total: counts.receipts, rows: await all(db, `SELECT r.id, COALESCE(r.vendor, r.read_vendor) AS vendor, COALESCE(r.total_cents, r.read_total_cents) AS total_cents, d.name AS file
      FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id WHERE r.status = 'review' ORDER BY r.received_at, r.id LIMIT ${ROWS}`) },
    journalDrafts: { total: counts.journalDrafts, rows: await all(db, `SELECT e.id, e.memo, (SELECT COALESCE(SUM(l.debit_cents), 0) FROM pt_journal_lines l WHERE l.entry_id = e.id) AS total_cents
      FROM pt_journal_entries e WHERE e.status = 'draft' ORDER BY e.entry_date DESC, e.id LIMIT ${ROWS}`) },
    proposals: { total: counts.proposals, rows: await all(db, `SELECT id, summary FROM pt_proposals WHERE status = 'proposed' ORDER BY created_at, id LIMIT ${ROWS}`) },
    reopenRequests: counts.reopenRequests,
    missingByMonth: (await missingSources(db, business?.books_start ?? '0001-01-01', asOf)).missingByMonth,
    overdue: await overdueBalances(db, asOf),
  }
}
