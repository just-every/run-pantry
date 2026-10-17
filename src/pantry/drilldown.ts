// Every figure on the profit and loss and the balance sheet opens to the lines
// behind it: the posting (or, on the cash basis, the settled share of an
// invoice, credit or bill), the record it came from, what settled it, its
// documents and the bank statement lines it was matched to. The rows are read
// separately from the report and must add up to the report's own figure.
import { longDay, requireThat, type Data } from './core'
import { all } from './db'
import { cashLines, sameOnCash, type Basis } from './basis'
import { balanceSheet, prevDay, profitAndLoss, settlementMemo } from './reports'
import { attachments, bankMatches, recordLabels, recordOf, type RecordRef } from './records'

type Scope = { label: string; types: string[]; accountId?: string; from: string; to: string; sign: 1 | -1; figure: number }

const START = '0000-01-01'

async function scope(db: D1Database, report: string, line: string, from: string, to: string, basis: Basis, startMonth: number): Promise<Scope> {
  const accounts = new Map((await all(db, 'SELECT id, code, name, type FROM pt_accounts')).map(a => [a.id, a]))
  const account = accounts.get(line)
  const natural = (type: string): 1 | -1 => type === 'asset' || type === 'expense' ? 1 : -1
  if (report === 'profit-and-loss') {
    const pl = await profitAndLoss(db, from, to, basis)
    if (account) {
      requireThat(account.type === 'income' || account.type === 'expense', 'That account is not on the profit and loss')
      const row = [...pl.income, ...pl.expenses].find(r => r.id === line)
      return { label: `${account.code} · ${account.name}`, types: [], accountId: line, from, to, sign: natural(account.type), figure: row?.amount ?? 0 }
    }
    if (line === 'income') return { label: 'Total income', types: ['income'], from, to, sign: -1, figure: pl.totalIncome }
    if (line === 'expenses') return { label: 'Total expenses', types: ['expense'], from, to, sign: 1, figure: pl.totalExpenses }
    if (line === 'net-income') return { label: 'Net income', types: ['income', 'expense'], from, to, sign: -1, figure: pl.netIncome }
  }
  if (report === 'balance-sheet') {
    const bs = await balanceSheet(db, to, startMonth, basis)
    if (account) {
      requireThat(['asset', 'liability', 'equity'].includes(account.type), 'That account is not on the balance sheet')
      const row = [...bs.assets, ...bs.liabilities, ...bs.equity].find(r => r.id === line)
      return { label: `${account.code} · ${account.name}`, types: [], accountId: line, from: START, to, sign: natural(account.type), figure: row?.amount ?? 0 }
    }
    const earnings = (id: string) => bs.equity.find(r => r.id === id)?.amount ?? 0
    if (line === 'assets') return { label: 'Total assets', types: ['asset'], from: START, to, sign: 1, figure: bs.totalAssets }
    if (line === 'liabilities') return { label: 'Total liabilities', types: ['liability'], from: START, to, sign: -1, figure: bs.totalLiabilities }
    // Equity includes the calculated earnings lines, so it opens to every income and expense line too.
    if (line === 'equity') return { label: 'Total equity', types: ['equity', 'income', 'expense'], from: START, to, sign: -1, figure: bs.totalEquity }
    if (line === 'liabilities-and-equity') return { label: 'Liabilities and equity', types: ['liability', 'equity', 'income', 'expense'], from: START, to, sign: -1, figure: bs.totalLiabilities + bs.totalEquity }
    if (line === 'current-earnings') return { label: `Net income since ${longDay(bs.fyStart)} (calculated)`, types: ['income', 'expense'], from: bs.fyStart, to, sign: -1, figure: earnings('current-earnings') }
    if (line === 'prior-earnings') return { label: "Prior years' earnings (calculated)", types: ['income', 'expense'], from: START, to: prevDay(bs.fyStart), sign: -1, figure: earnings('prior-earnings') }
  }
  requireThat(false, 'Choose a figure on the profit and loss or the balance sheet', 404)
  throw new Error('unreachable')
}

export async function figureDetail(db: D1Database, q: { report: string; line: string; from: string; to: string; basis: Basis }, startMonth: number) {
  const s = await scope(db, q.report, q.line, q.from, q.to, q.basis, startMonth)
  const accounts = new Map((await all(db, 'SELECT id, code, name, type FROM pt_accounts')).map(a => [a.id, a]))
  const inScope = (accountId: string) => s.accountId ? accountId === s.accountId : s.types.includes(accounts.get(accountId)?.type)
  const filter = s.accountId ? 'l.account_id = ?' : `a.type IN (${s.types.map(() => '?').join(', ')})`
  const posted = await all(db, `SELECT l.id AS line_id, l.account_id, l.debit_cents, l.credit_cents, l.memo, e.id AS entry_id, e.number, e.entry_date, e.memo AS entry_memo, e.source_kind, e.source_id, e.document_id, e.reverses_id
    FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND ${filter} ${q.basis === 'cash' ? `AND ${sameOnCash()}` : ''}
    ORDER BY e.entry_date, e.number, l.line_no`, s.from, s.to, ...(s.accountId ? [s.accountId] : s.types))
  const labels = await recordLabels(db), docs = await attachments(db), bank = await bankMatches(db)
  const account = (id: string) => { const a = accounts.get(id)!; return { id: a.id, code: a.code, name: a.name } }
  const rows: Data[] = posted.map(l => {
    const record = recordOf(l, labels)
    return { key: l.line_id, date: l.entry_date, account: account(l.account_id), amount: s.sign * (l.debit_cents - l.credit_cents), debit: l.debit_cents, credit: l.credit_cents,
      description: l.entry_memo, lineMemo: l.memo, entry: { id: l.entry_id, number: l.number }, record, settlement: null,
      documents: docs.forRecords([record, { kind: 'entry', id: l.entry_id }], l.document_id), bank: bank.forLine(l.line_id, l.entry_id, record) }
  })
  if (q.basis === 'cash') for (const [i, c] of (await cashLines(db, s.from, s.to)).entries()) {
    if (!inScope(c.accountId)) continue
    const record: RecordRef = { kind: c.docKind === 'bill' ? 'bill' : 'invoice', id: c.docId, label: labels.label(c.docKind === 'bill' ? 'bill' : 'invoice', c.docId) }
    const by: RecordRef | null = c.settlement.paymentId ? { kind: 'payment', id: c.settlement.paymentId, label: labels.label('payment', c.settlement.paymentId) }
      : c.settlement.kind === 'credit' ? { kind: 'invoice', id: c.settlement.creditId!, label: labels.label('invoice', c.settlement.creditId!) }
      : { kind: 'invoice', id: c.settlement.appliedToId!, label: labels.label('invoice', c.settlement.appliedToId!) }
    rows.push({ key: `cash-${i}`, date: c.date, account: account(c.accountId), amount: s.sign * c.net, debit: Math.max(c.net, 0), credit: Math.max(-c.net, 0),
      description: settlementMemo(c), lineMemo: c.description, entry: { id: c.docJournalId, number: null }, record,
      settlement: { kind: c.settlement.kind, by, share: `${(c.settledAfter / 100).toFixed(2)} of ${(c.docTotal / 100).toFixed(2)} settled` },
      documents: docs.forRecords([record, { kind: 'entry', id: c.docJournalId }, ...(by ? [by] : [])]), bank: by?.kind === 'payment' ? bank.forPayment(by.id) : [] })
  }
  rows.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0)
  const total = rows.reduce((t, r) => t + r.amount, 0)
  return { basis: q.basis, report: q.report, line: q.line, label: s.label, from: s.from === START ? null : s.from, to: s.to, figure: s.figure, rows, total, ties: total === s.figure }
}
