import type { DimensionScope } from '../dimensions/scope'
// Sales by item (ITEM-001, REPORT-004): income grouped by the item each
// invoice or credit line was sold as, on the accrual or cash basis. Income that
// carries no item (lines typed without one, direct postings) stays visible as
// one row, so the total ties to the profit and loss income for the same range.
import { all } from '../db'
import { generalLedger } from '../reports'
import type { Basis } from '../basis'
import type { Data } from '../core'

/** The item an income line was sold as; the report and its drill-through share it. */
export async function itemGrouping(db: D1Database) {
  const items = new Map((await all(db, 'SELECT id, name, sku, active FROM pt_items')).map(i => [i.id, i]))
  // An issued document posts its receivable on line 1 and its Nth sale line on journal line N + 1; a reversal keeps that order.
  const sold = new Map((await all(db, `SELECT i.journal_id, l.line_no, l.account_id, l.item_id FROM pt_invoice_lines l JOIN pt_invoices i ON i.id = l.invoice_id
    WHERE i.journal_id IS NOT NULL AND l.item_id IS NOT NULL`)).map(r => [`${r.journal_id}:${r.line_no + 1}`, r]))
  const corrections=new Map((await all(db,'SELECT r.correcting_entry_id,l.entry_id,l.line_no FROM pt_reclassifications r JOIN pt_journal_lines l ON l.id=r.document_line_id WHERE r.document_line_id IS NOT NULL')).map(r=>[r.correcting_entry_id,r]))
  return {
    of: (line: Data) => {
      const root=corrections.get(line.reverses_id??line.entry_id)
      const posted = sold.get(root?`${root.entry_id}:${root.line_no}`:`${line.reverses_id ?? line.entry_id}:${line.line_no}`)
      const itemId: string | null = String(line.id).startsWith('cash-') ? line.item_id ?? null : posted && posted.account_id === line.account_id ? posted.item_id : null
      return itemId && items.has(itemId) ? itemId : 'unassigned'
    },
    item: (id: string) => items.get(id) ?? null,
  }
}

export async function salesByItem(db: D1Database, from: string, to: string, basis: Basis, dimension?: DimensionScope) {
  const grouping = await itemGrouping(db)
  const groups = new Map<string, { id: string; name: string; sku: string | null; amount: number }>()
  const ledger = await generalLedger(db, from, to, undefined, basis, dimension)
  for (const account of ledger.accounts.filter(a => a.type === 'income')) for (const line of account.rows) {
    const id = grouping.of(line), it = grouping.item(id)
    const group = groups.get(id) ?? { id, name: it ? it.name : 'No item (other income)', sku: it?.sku ?? null, amount: 0 }
    group.amount += line.credit_cents - line.debit_cents
    groups.set(id, group)
  }
  const rows = [...groups.values()].filter(r => r.amount !== 0).sort((a, b) => a.id === 'unassigned' ? 1 : b.id === 'unassigned' ? -1 : a.name.localeCompare(b.name))
  return { basis, from, to, ...(dimension ? { dimension } : {}), rows, total: rows.reduce((sum, r) => sum + r.amount, 0) }
}
