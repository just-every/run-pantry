import { inDimension, type DimensionScope } from './dimensions/scope'
// Income and costs grouped by the counterparty carried by the posted line or
// its source document. Unassigned postings stay visible so totals tie to P&L.
import { all } from './db'
import { cashLines, sameOnCash, type Basis } from './basis'
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
  const groups = new Map<string, { id: string; name: string; amount: number }>()
  const type = kind==='customer'?'income':'expense', sign=kind==='customer'?-1:1
  // Aggregate only the requested account family at D1. A summary must not
  // transport the entire general ledger merely to discard its individual rows.
  const posted=await all<{id:string;name:string;amount:number}>(db,`SELECT COALESCE(c.id,'unassigned') AS id,COALESCE(c.name,'Unassigned') AS name,SUM(l.debit_cents-l.credit_cents) AS amount
    FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id JOIN pt_accounts a ON a.id=l.account_id
    LEFT JOIN pt_invoices i ON i.journal_id=COALESCE(e.reverses_id,e.id)
    LEFT JOIN pt_bills b ON b.journal_id=COALESCE(e.reverses_id,e.id)
    LEFT JOIN pt_vendor_credits v ON v.journal_id=COALESCE(e.reverses_id,e.id)
    LEFT JOIN pt_contacts c ON c.id=COALESCE(NULLIF(l.contact_id,''),i.customer_id,b.vendor_id,v.vendor_id) AND c.kind=?
    WHERE e.status='posted' AND e.entry_date BETWEEN ? AND ? AND a.type=? ${basis==='cash'?`AND ${sameOnCash()}`:''} ${dimension?`AND l.${dimension.kind}_name=?`:''}
    GROUP BY c.id,c.name`,kind,from,to,type,...(dimension?[dimension.value]:[]))
  for(const row of posted)groups.set(row.id,{...row,amount:Number(row.amount)*sign})
  if(basis==='cash') {
    const accounts=new Map((await all(db,'SELECT id,type FROM pt_accounts')).map(a=>[a.id,a.type]))
    const contacts=new Map((await all(db,'SELECT id,kind,name FROM pt_contacts')).map(c=>[c.id,c]))
    for(const line of await cashLines(db,from,to)) {
      if(accounts.get(line.accountId)!==type || !inDimension(line,dimension))continue
      const contact=contacts.get(line.contactId),id=contact?.kind===kind?line.contactId:'unassigned'
      const group=groups.get(id)??{id,name:id==='unassigned'?'Unassigned':contact!.name as string,amount:0}
      group.amount+=line.net*sign;groups.set(id,group)
    }
  }
  const rows = [...groups.values()].filter(r => r.amount !== 0).sort((a, b) => a.name.localeCompare(b.name))
  return { basis, from, to, ...(dimension ? { dimension } : {}), kind, rows, total: rows.reduce((sum, r) => sum + r.amount, 0) }
}
