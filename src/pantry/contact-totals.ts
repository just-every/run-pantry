import type { DimensionScope } from './dimensions/scope'
// Income and costs grouped by the counterparty carried by the posted line or
// its source document. Unassigned postings stay visible so totals tie to P&L.
import { generalLedger } from './reports'
import { all } from './db'
import type { Basis } from './basis'
import type { Data } from './core'

/** The counterparty group of a posted or settled ledger line; the report and its drill-through share it. */
export async function contactGrouping(db: D1Database, kind: 'customer' | 'vendor') {
  const contacts = new Map((await all(db, 'SELECT id, kind, name FROM pt_contacts')).map(c => [c.id, c]))
  const sources = new Map((await all(db, `SELECT e.id AS journal_id, COALESCE(i.customer_id, b.vendor_id, v.vendor_id) AS contact_id
    FROM pt_journal_entries e
    LEFT JOIN pt_invoices i ON i.journal_id = COALESCE(e.reverses_id, e.id)
    LEFT JOIN pt_bills b ON b.journal_id = COALESCE(e.reverses_id, e.id)
    LEFT JOIN pt_vendor_credits v ON v.journal_id = COALESCE(e.reverses_id, e.id)`)).map(s => [s.journal_id, s.contact_id]))
  return {
    of: (line: Data) => { const contact = contacts.get(line.contact_id || sources.get(line.entry_id)); return contact?.kind === kind ? contact.id as string : 'unassigned' },
    name: (id: string) => id === 'unassigned' ? 'Unassigned' : contacts.get(id)!.name as string,
  }
}

export async function contactTotals(db: D1Database, kind: 'customer' | 'vendor', from: string, to: string, basis: Basis, dimension?: DimensionScope) {
  const grouping = await contactGrouping(db, kind)
  const groups = new Map<string, { id: string; name: string; amount: number }>()
  const ledger = await generalLedger(db, from, to, undefined, basis, dimension)
  for (const account of ledger.accounts.filter(a => a.type === (kind === 'customer' ? 'income' : 'expense'))) {
    for (const line of account.rows) {
      const id = grouping.of(line)
      const group = groups.get(id) ?? { id, name: grouping.name(id), amount: 0 }
      group.amount += (line.debit_cents - line.credit_cents) * (kind === 'customer' ? -1 : 1)
      groups.set(id, group)
    }
  }
  const rows = [...groups.values()].filter(r => r.amount !== 0).sort((a, b) => a.name.localeCompare(b.name))
  return { basis, from, to, ...(dimension ? { dimension } : {}), kind, rows, total: rows.reduce((sum, r) => sum + r.amount, 0) }
}
