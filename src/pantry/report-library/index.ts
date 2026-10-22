import { dimensionReconciliation } from '../dimensions/reconciliation'
import type { DimensionScope } from '../dimensions/scope'
// Everyday report variants share the seed's posted ledger and native evidence.
import { addDays, requireThat, type Data } from '../core'
import { all } from '../db'
import type { Basis } from '../basis'
import { reconciliationState } from '../reconcile'
import { openItems } from './open-items'
import { ledgerActivity, paymentActivity } from './activity'
import { LIBRARY, isLibrary, type LibraryReport } from './types'
export { isLibrary, LIBRARY } from './types'

/** Payments to marked 1099 vendors in the range, unreversed as of its end, with their summary group and method class. */
export async function contractorPayments(db: D1Database, from: string, to: string, dimension?: DimensionScope): Promise<Data[]> {
  return (await all(db, `SELECT p.*,SUM(l.credit_cents-l.debit_cents) AS amount_cents, c.name, substr(p.payment_date,1,4) AS year FROM pt_payments p JOIN pt_contacts c ON c.id=p.contact_id
    JOIN pt_bank_accounts bank ON bank.id=p.bank_account_id JOIN pt_journal_lines l ON l.entry_id=p.journal_id AND l.account_id=bank.account_id
    LEFT JOIN pt_journal_entries r ON r.id=p.reversal_id WHERE p.direction='paid' AND c.is_1099=1 AND p.payment_date BETWEEN ? AND ? AND (p.reversal_id IS NULL OR r.entry_date > ?) ${dimension?`AND l.${dimension.kind}_name=?`:''} GROUP BY p.id ORDER BY year,c.name,p.payment_date,p.id`, from, to, to,...(dimension?[dimension.value]:[])))
    .map(p => ({ ...p, group: `${p.contact_id}:${p.year}`, class: ['check', 'ach', 'wire', 'cash'].includes(p.method) ? 'counted' : ['card', 'payment-network'].includes(p.method) ? 'excluded' : 'unknown' }))
}

export async function libraryReport(db: D1Database, kind: string, from: string, to: string, basis: Basis, account?: string, payee?: string, dimension?: DimensionScope): Promise<LibraryReport> {
  requireThat(isLibrary(kind), 'Unknown library report', 404)
  requireThat(!dimension || ['audit-log','reconciliations','deposits','check-detail','contractor-summary','transactions','journal','receivables-summary','payables-summary','open-invoices','unpaid-bills','customer-balances','vendor-balances'].includes(kind), 'This library report does not yet support a dimension filter', 409)
  requireThat(from <= to, 'The end date is on or after the start date')
  let data: Partial<LibraryReport>
  if (['transactions', 'journal'].includes(kind)) data = await ledgerActivity(db, kind, from, to, basis, account, payee, dimension)
  else if (kind === 'deposits' || kind === 'check-detail') data = await paymentActivity(db, kind, from, to, dimension)
  else if (kind === 'reconciliations') {
    const statements = await all(db, 'SELECT id FROM pt_statements WHERE end_date BETWEEN ? AND ? ORDER BY end_date,id', from, to)
    const states = await Promise.all(statements.map(s => reconciliationState(db, s.id)))
    data = { basis: 'accrual', basisLabel: 'Statement reconciliation - accrual ledger', note: (dimension?'Dimension contributions: external statement opening and closing balances are Unassigned; book, cleared and outstanding figures use bank-posting coding retained at completion. Whole-statement completion status is not a separate dimension reconciliation. ':'')+'Statements ending within the inclusive range. Completed rows use their immutable saved proof; unfinished rows show the current PAN-09 proof and blockers. Closing balances are per statement, not added across successive statements.',
      columns: ['End date', 'Bank', 'Opening', 'Statement closing', 'Book', 'Outstanding', 'Cleared', 'Difference', 'Status'], moneyColumns: [2, 3, 4, 5, 6, 7],
      rows: await Promise.all(states.map(async s => {
        const proof = s.completed ? JSON.parse(s.completed.proof) : s
        const outstanding = s.completed ? s.completed.outstanding_cents : s.outstandingTotal
        const selected=dimension?await dimensionReconciliation(db,s,dimension):null
        return { id: s.statement.id, cells: [s.statement.end_date, s.bank.name, selected?.opening??proof.opening, selected?.closing??proof.closing, selected?.book??proof.book, selected?.outstanding??outstanding, selected?.cleared??proof.cleared, selected?.difference??(proof.closing-proof.cleared), s.completed ? dimension?'Whole statement reconciled':'Reconciled' : 'Unfinished'], href: `/app/bank?statement=${encodeURIComponent(s.statement.id)}`, details: { proof, blockers: s.completed ? [] : s.blockers, completedBy: s.completed?.completed_by ?? null } }
      })), totals: [] }
  } else if (kind === 'audit-log') {
    const rows = await all(db, `SELECT a.* FROM pt_audit a WHERE at >= ? AND at < ? ${dimension ? `AND ${dimension.value ? 'EXISTS' : 'NOT EXISTS'} (SELECT 1 FROM pt_audit_dimensions d WHERE d.audit_id=a.id AND d.kind=? ${dimension.value ? 'AND d.name=?' : ''})` : ''} ORDER BY at,id`, `${from}T00:00:00`, `${addDays(to, 1)}T00:00:00`, ...(dimension ? [dimension.kind, ...(dimension.value ? [dimension.value] : [])] : []))
    data = { basis: 'history', basisLabel: 'Activity history', note: 'Dimension filters use frozen event-time memberships; an event concerning several values appears in each relevant split. Unassigned includes events with no recorded membership, including older history. Event counts are not additive. Audit events timestamped within the inclusive UTC date range. Event counts and history are independent of the financial-report basis.',
      columns: ['When (UTC)', 'Actor', 'Action', 'Record kind', 'Record'], moneyColumns: [],
      rows: rows.map(r => ({ id: r.id, cells: [r.at, r.actor_email, r.action, r.subject_kind, r.subject_id], details: { ...r, detail: JSON.parse(r.detail) } })), totals: [] }
  } else if (kind === 'contractor-summary') {
    const payments = await contractorPayments(db, from, to, dimension)
    const grouped = new Map<string, { name: string; year: string; counted: number; excluded: number; unknown: number }>()
    for (const p of payments) {
      const key = p.group, r = grouped.get(key) ?? { name: p.name, year: p.year, counted: 0, excluded: 0, unknown: 0 }
      r[p.class as 'counted' | 'excluded' | 'unknown'] += p.amount_cents; grouped.set(key, r)
    }
    data = { basis: 'payment', basisLabel: 'Payment basis', note: 'Marked 1099 vendors, grouped by payment calendar year within the inclusive range; card/network payments and unknown methods remain separate. This is a payment summary, not a filing or threshold determination.',
      columns: ['Tax year', 'Vendor', '1099-NEC eligible methods', 'Card/network excluded', 'Method not recorded'], moneyColumns: [2, 3, 4],
      rows: [...grouped].map(([id, r]) => ({ id, cells: [r.year, r.name, r.counted, r.excluded, r.unknown] })), totals: [{ label: 'Eligible-method payments', amount: payments.filter(p => p.class === 'counted').reduce((n, p) => n + p.amount_cents, 0) }] }
  } else data = await openItems(db, kind, from, to, dimension)
  return { kind, title: LIBRARY[kind] + (dimension ? ` · ${dimension.label}` : ''), from, to, basis: 'accrual', basisLabel: 'Open items - accrual basis', ...data } as LibraryReport
}
