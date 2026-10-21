// Sales by customer, expenses by vendor, sales by item and profit-and-loss
// customer columns: a grouped figure opens to exactly the general-ledger rows
// its report grouped (same grouping function, same row keys), read through the
// shared source reader so each row carries its record, documents and bank lines.
import { requireThat, type Data } from '../core'
import type { Basis } from '../basis'
import { generalLedger } from '../reports'
import { reportSourceRows } from '../report-sources'
import { contactGrouping, contactTotals } from '../contact-totals'
import { itemGrouping, salesByItem } from '../items/report'
import { figureResult } from './result'

type Scope = { types: string[]; accountId?: string; of: (line: Data) => string; selected: string; from: string; to: string; basis: Basis; sign: 1 | -1 }

/** Source rows whose ledger row falls in the selected group ('total' keeps every group). */
export async function groupedRows(db: D1Database, s: Scope) {
  const ledger = await generalLedger(db, s.from, s.to, undefined, s.basis)
  const keys = new Set<string>()
  for (const a of ledger.accounts) if (s.accountId ? a.id === s.accountId : s.types.includes(a.type))
    for (const l of a.rows) if (s.selected === 'total' || s.of(l) === s.selected) keys.add(String(l.id))
  return (await reportSourceRows(db, { accountId: s.accountId, types: s.types, from: s.from, to: s.to, sign: s.sign }, s.basis)).filter(r => keys.has(r.key))
}

export async function contactFigure(db: D1Database, report: 'sales-by-customer' | 'expenses-by-vendor', line: string, from: string, to: string, basis: Basis) {
  const kind = report === 'sales-by-customer' ? 'customer' : 'vendor'
  const r = await contactTotals(db, kind, from, to, basis), row = r.rows.find(x => x.id === line)
  requireThat(line === 'total' || row, `Choose a ${kind} on this report`, 404)
  const grouping = await contactGrouping(db, kind)
  const rows = await groupedRows(db, { types: [kind === 'customer' ? 'income' : 'expense'], of: grouping.of, selected: line, from, to, basis, sign: kind === 'customer' ? -1 : 1 })
  return figureResult({ report, line, label: `${row ? row.name : 'Total'} · ${kind === 'customer' ? 'sales' : 'expenses'}`, basis, from, to, figure: row ? row.amount : r.total, rows })
}

export async function itemFigure(db: D1Database, line: string, from: string, to: string, basis: Basis) {
  const r = await salesByItem(db, from, to, basis), row = r.rows.find(x => x.id === line)
  requireThat(line === 'total' || row, 'Choose a product or service on this report', 404)
  const grouping = await itemGrouping(db)
  const rows = await groupedRows(db, { types: ['income'], of: grouping.of, selected: line, from, to, basis, sign: -1 })
  return figureResult({ report: 'sales-by-item', line, label: `${row ? row.name : 'Total'} · sales`, basis, from, to, figure: row ? row.amount : r.total, rows })
}
