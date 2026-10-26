import { addDays, requireThat, type Data } from '../core'
import { customerHistory } from '../customer-history'
import { all, one } from '../db'

export type StatementMode = 'open-items' | 'balance-forward' | 'transaction-list'

const financialRow = (r: Data) => ({ kind: r.kind, id: r.id, date: r.date, due_date: r.due_date ?? null,
  reference: r.reference ?? '', total_cents: r.total_cents, balance_cents: r.balance_cents ?? 0, href: r.href })
const signed = (r: Data, amount: number) => ['invoice','refund'].includes(r.kind) ? amount : -amount

export async function statementSnapshot(db: D1Database, customerId: string, mode: StatementMode, from: string, to: string) {
  const [history, opening, entity] = await Promise.all([
    customerHistory(db, customerId, to),
    mode === 'open-items' ? Promise.resolve(null) : customerHistory(db, customerId, addDays(from, -1)),
    one(db, 'SELECT legal_name FROM pt_entity WHERE id=1'),
  ])
  const source = history.rows.filter(r => ['invoice', 'credit', 'payment', 'refund'].includes(r.kind))
  const active = source.filter(r => r.included_in_balance && r.status !== 'Reversed')
  const refundRows = source.filter(r => r.kind === 'refund' && r.status === 'succeeded' && r.date <= to)
  let rows: Data[]
  if (mode === 'open-items') {
    rows = active.filter(r => r.balance_cents > 0).map(r => ({ ...financialRow(r), amount_cents: signed(r, r.balance_cents) }))
  } else {
    rows = [...active, ...refundRows].filter(r => r.date >= from).map(r => ({ ...financialRow(r), amount_cents: signed(r, r.total_cents) }))
    // A reversal of an opening item restores the balance during this period.
    // Pairs originating and reversed inside the range already net to zero.
    const [payments, credits, voids] = await Promise.all([
      all(db, `SELECT p.id,p.reference,p.amount_cents,r.entry_date FROM pt_payments p JOIN pt_journal_entries r ON r.id=p.reversal_id
        WHERE p.contact_id=? AND p.direction='received' AND p.payment_date<? AND r.entry_date BETWEEN ? AND ?`, customerId, from, from, to),
      all(db, `SELECT i.id,i.number,i.total_cents,min(a.voided_on) AS reversal_date FROM pt_invoices i JOIN pt_allocations a ON a.source_kind='credit' AND a.source_id=i.id
        WHERE i.customer_id=? AND i.kind='credit' AND i.status='issued' AND i.issue_date<? AND a.voided_on IS NOT NULL
        GROUP BY i.id HAVING min(a.voided_on) BETWEEN ? AND ?`, customerId, from, from, to),
      all(db, `SELECT id,number,total_cents,void_date FROM pt_invoices WHERE customer_id=? AND kind='invoice' AND void_date IS NOT NULL AND issue_date<? AND void_date BETWEEN ? AND ?`, customerId, from, from, to),
    ])
    rows.push(...voids.map(i => ({ kind: 'invoice-void', id: i.id, date: i.void_date, due_date: null,
      reference: `Void invoice ${i.number}`, total_cents: i.total_cents, balance_cents: 0, amount_cents: -i.total_cents,
      href: `/app/reports?record=${encodeURIComponent(`invoice:${i.id}`)}` })), ...payments.map(p => ({ kind: 'payment-reversal', id: p.id, date: p.entry_date, due_date: null,
      reference: `Reversed payment ${p.reference || p.id}`, total_cents: p.amount_cents, balance_cents: 0, amount_cents: p.amount_cents,
      href: `/app/reports?record=${encodeURIComponent(`payment:${p.id}`)}` })),
    ...credits.map(p => ({ kind: 'credit-reversal', id: p.id, date: p.reversal_date, due_date: null,
      reference: `Reversed credit ${p.number}`, total_cents: p.total_cents, balance_cents: 0, amount_cents: p.total_cents,
      href: `/app/reports?record=${encodeURIComponent(`invoice:${p.id}`)}` })))
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
  const openingBalance = opening?.summary.open_balance_cents ?? 0
  const closingBalance = history.summary.open_balance_cents
  requireThat(openingBalance + rows.reduce((n, r) => n + r.amount_cents, 0) === closingBalance,
    'The statement does not tie to receivables; reload the customer history before sending', 409)
  let running = openingBalance
  for (const row of rows) { running += row.amount_cents; row.running_balance_cents = running }
  return { customer_id: customerId, customer_name: (history.customer as Data).name, business_name: String(entity?.legal_name ?? ''),
    mode, from, to, as_of: to, currency: 'USD', rows, opening_balance_cents: openingBalance, closing_balance_cents: closingBalance,
    open_invoice_cents: history.summary.open_invoice_cents, unallocated_payment_cents: history.summary.unallocated_payment_cents,
    unallocated_credit_cents: history.summary.unallocated_credit_cents, ageing_items: history.summary.ageing_items,
    ageing_totals: history.summary.ageing_totals, ageing_href: history.summary.ageing_href }
}
