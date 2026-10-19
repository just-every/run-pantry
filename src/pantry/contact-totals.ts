// Income and costs grouped by the counterparty carried by the posted line or
// its source document. Unassigned postings stay visible so totals tie to P&L.
import { generalLedger } from './reports'
import { all } from './db'
import type { Basis } from './basis'

export async function contactTotals(db: D1Database, kind: 'customer' | 'vendor', from: string, to: string, basis: Basis) {
  const contacts = new Map((await all(db, 'SELECT id, kind, name FROM pt_contacts')).map(c => [c.id, c]))
  const sources = new Map((await all(db, `SELECT e.id AS journal_id, COALESCE(i.customer_id, b.vendor_id, v.vendor_id) AS contact_id
    FROM pt_journal_entries e
    LEFT JOIN pt_invoices i ON i.journal_id = COALESCE(e.reverses_id, e.id)
    LEFT JOIN pt_bills b ON b.journal_id = COALESCE(e.reverses_id, e.id)
    LEFT JOIN pt_vendor_credits v ON v.journal_id = COALESCE(e.reverses_id, e.id)`)).map(s => [s.journal_id, s.contact_id]))
  const groups = new Map<string, { id: string; name: string; amount: number }>()
  const ledger = await generalLedger(db, from, to, undefined, basis)
  for (const account of ledger.accounts.filter(a => a.type === (kind === 'customer' ? 'income' : 'expense'))) {
    for (const line of account.rows) {
      const contact = contacts.get(line.contact_id || sources.get(line.entry_id))
      const id = contact?.kind === kind ? contact.id : 'unassigned'
      const group = groups.get(id) ?? { id, name: id === 'unassigned' ? 'Unassigned' : contact!.name, amount: 0 }
      group.amount += (line.debit_cents - line.credit_cents) * (kind === 'customer' ? -1 : 1)
      groups.set(id, group)
    }
  }
  const rows = [...groups.values()].filter(r => r.amount !== 0).sort((a, b) => a.name.localeCompare(b.name))
  return { basis, from, to, kind, rows, total: rows.reduce((sum, r) => sum + r.amount, 0) }
}
