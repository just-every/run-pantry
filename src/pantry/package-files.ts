// The accountant package as files an accountant opens: one CSV per report, the close
// checklist, the reconciliations and the documents list, a README saying what is where,
// and the same package as JSON for software. Every figure comes from accountantPackage.
import type { Data } from './core'
import { accountantPackage, ledgerCsv } from './package'
import { cashFlowCsv } from './cash-flow'
import { zip } from './zip'
import type { Basis } from './basis'

const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s }
const csv = (rows: unknown[][]) => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
const money = (c: number | null | undefined) => c === null || c === undefined ? '' : (c / 100).toFixed(2)

function statement(sections: [string, Data[], number][], total?: [string, number]) {
  const rows: unknown[][] = [['Section', 'Account code', 'Account', 'Amount']]
  for (const [title, lines, sum] of sections) { for (const l of lines) rows.push([title, l.code, l.name, money(l.amount)]); rows.push([title, '', `Total ${title.toLowerCase()}`, money(sum)]) }
  if (total) rows.push(['', '', total[0], money(total[1])])
  return csv(rows)
}

const ageing = (a: Data) => csv([['Who', 'Reference', 'Due', 'Days overdue', 'Bucket', 'Open'],
  ...a.items.map((i: Data) => [i.contact, i.ref, i.due_date, Math.max(0, i.overdue), i.bucket, money(i.open)]),
  ['Total', '', '', '', '', money(a.itemsTotal)], ...(a.unapplied ? [['Received or credited, not yet applied', '', '', '', '', money(-a.unapplied)]] : [])])

/** The package's files and the archive's name. */
export async function packageZip(db: D1Database, period: string, basis: Basis) {
  const p = await accountantPackage(db, period, basis), basisName = p.basis
  const pl = (r: Data) => statement([['Income', r.income, r.totalIncome], ['Expenses', r.expenses, r.totalExpenses]], ['Net income', r.netIncome])
  const bs = p.balanceSheet
  const files = [
    { name: 'cash-flow.csv', data: cashFlowCsv(p.cashFlow) },
    { name: 'README.txt', data: [
      `Accountant package for ${p.entity.legalName}, ${p.period.start} to ${p.period.end}.`,
      `Ledger reports are on the ${basisName.toLowerCase()}; cash-flow starts from accrual net income. Figures are in US dollars, recalculated from the posted ledger on ${p.generatedAt.slice(0, 10)}.`,
      `The month is ${p.close.status === 'locked' ? 'locked' : 'not locked yet'}.`, '',
      'trial-balance.csv            Debit and credit balance of every account at the end of the month',
      'profit-and-loss.csv          Income and expenses for the month',
      'profit-and-loss-ytd.csv      Income and expenses for the fiscal year to date',
      'cash-flow.csv                Indirect cash flow, with opening and closing cash',
      'balance-sheet.csv            Assets, liabilities and equity at the end of the month',
      'general-ledger.csv           Every posted line in the month, by account, with running balances and receipts',
      'receivables-aging.csv        Open customer invoices at the end of the month',
      'payables-aging.csv           Unpaid bills at the end of the month',
      'reconciliations.csv          Bank statements reconciled through the end of the month',
      'voided-reconciliations.json  Retained proofs, statement snapshots and undo reasons',
      'close-checklist.csv          The close checks and review tasks, with who did them',
      'audit-history.json          Immutable actions, revisions, approvals and before/after values',
      'documents.csv                Every document kept in Pantry, with its SHA-256; open them in Pantry',
      'pantry-package.json          All of the above in one file, for software', ''].join('\r\n') },
    { name: 'trial-balance.csv', data: csv([['Account code', 'Account', 'Debit', 'Credit'], ...p.trialBalance.rows.map((r: Data) => [r.code, r.name, r.debitBalance ? money(r.debitBalance) : '', r.creditBalance ? money(r.creditBalance) : '']), ['', 'Total', money(p.trialBalance.debit), money(p.trialBalance.credit)]]) },
    { name: 'profit-and-loss.csv', data: pl(p.profitAndLoss.period) },
    { name: 'profit-and-loss-ytd.csv', data: pl(p.profitAndLoss.yearToDate) },
    { name: 'balance-sheet.csv', data: statement([['Assets', bs.assets, bs.totalAssets], ['Liabilities', bs.liabilities, bs.totalLiabilities], ['Equity', bs.equity, bs.totalEquity]], ['Liabilities and equity', bs.totalLiabilities + bs.totalEquity]) },
    { name: 'general-ledger.csv', data: await ledgerCsv(db, period, basis) },
    { name: 'receivables-aging.csv', data: ageing(p.receivables) },
    { name: 'payables-aging.csv', data: ageing(p.payables) },
    { name: 'reconciliations.csv', data: csv([['Bank account', 'Statement end', 'Opening', 'Closing', 'Books', 'Outstanding', 'Reconciled by', 'Reconciled at'], ...p.reconciliations.map((r: Data) => [r.bank, r.end_date, money(r.opening_cents), money(r.closing_cents), money(r.book_cents), money(r.outstanding_cents), r.completed_by, r.completed_at])]) },
    { name: 'voided-reconciliations.json', data: JSON.stringify(p.voidedReconciliations, null, 2) },
    { name: 'close-checklist.csv', data: csv([['Kind', 'Item', 'Result', 'Detail', 'By', 'At', 'Assigned to', 'Due date'],
      ...p.close.checks.map((x: Data) => ['Check', x.title, x.ok ? 'Passes' : 'Open', x.detail, '', '', '', '']),
      ...p.close.tasks.map((t: Data) => ['Review task', t.title, t.status === 'done' ? 'Done' : 'Open', t.note, t.done_by ?? '', t.done_at ?? '', t.assignee ?? '', t.due_date ?? ''])]) },
    { name: 'audit-history.json', data: JSON.stringify({ audit: p.audit, approvals: p.approvals }, null, 2) },
    { name: 'documents.csv', data: csv([['Name', 'Type', 'Bytes', 'SHA-256', 'Attached to', 'Uploaded by', 'Uploaded at'], ...p.documents.map((d: Data) => [d.name, d.media_type, d.size, d.sha256, d.linked_kind ? `${d.linked_kind} ${d.linked_id}` : '', d.uploaded_by, d.uploaded_at])]) },
    { name: 'pantry-package.json', data: JSON.stringify(p, null, 2) },
  ]
  return { bytes: zip(files.map(f => ({ name: `pantry-close-${period}/${f.name}`, data: f.name.endsWith('.csv') ? `Basis,${f.name.includes('aging') ? 'Open items · accrual basis' : f.name === 'cash-flow.csv' ? 'Indirect method · starts from accrual net income' : basisName}\r\n${f.data}` : f.data }))), basis }
}
