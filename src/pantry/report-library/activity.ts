import type { DimensionScope } from '../dimensions/scope'
import { all } from '../db'
import { generalLedger } from '../reports'
import { BASIS_LABEL, type Basis } from '../basis'
import type { LibraryReport } from './types'

export async function ledgerActivity(db: D1Database, kind: string, from: string, to: string, basis: Basis, account?: string, payee?: string, dimension?: DimensionScope): Promise<Partial<LibraryReport>> {
  const gl = await generalLedger(db, from, to, account, basis, dimension)
  // Some source lines identify a contact only on their control line. Carry that
  // source contact to the other lines before applying a payee filter.
  const contacts = await all(db, `SELECT l.entry_id, l.contact_id, c.name FROM pt_journal_lines l JOIN pt_contacts c ON c.id=l.contact_id GROUP BY l.entry_id,l.contact_id`)
  const byEntry = new Map<string, (typeof contacts)[number]>()
  for (const contact of contacts) if ((!payee || contact.contact_id === payee) && !byEntry.has(contact.entry_id)) byEntry.set(contact.entry_id, contact)
  const rows = gl.accounts.flatMap(a => a.rows.map((l: any) => {
    const contact = byEntry.get(l.entry_id)
    return { ...l, account: `${a.code} · ${a.name}`, contact_id: l.contact_id ?? contact?.contact_id, contact_name: l.contact_name ?? contact?.name ?? '' }
  })).filter(l => !payee || l.contact_id === payee).sort((a, b) => a.entry_date.localeCompare(b.entry_date) || String(a.number ?? '').localeCompare(String(b.number ?? '')) || a.account.localeCompare(b.account))
  return { basis, basisLabel: BASIS_LABEL[basis], note: 'Posted lines within the inclusive date range. Cash basis substitutes settled invoice/bill shares on their settlement dates. Account and payee filters select lines; filtered journal totals need not balance.',
    columns: ['Date', 'Entry', 'Account', 'Payee', 'Description', 'Debit', 'Credit'], moneyColumns: [5, 6],
    rows: rows.map(l => ({ id: l.id, cells: [l.entry_date, l.number ?? 'Settled share', l.account, l.contact_name, [l.entry_memo, l.memo].filter(Boolean).join(' · '), l.debit_cents, l.credit_cents], record: `entry:${l.entry_id}` })),
    totals: [{ label: 'Debits', amount: rows.reduce((n, l) => n + l.debit_cents, 0) }, { label: 'Credits', amount: rows.reduce((n, l) => n + l.credit_cents, 0) }] }
}

export async function paymentActivity(db: D1Database, kind: string, from: string, to: string, dimension?: DimensionScope): Promise<Partial<LibraryReport>> {
  if (kind === 'deposits') {
    const rows = await all(db, `SELECT l.id,l.class_name,l.location_name,l.project_name,l.debit_cents-l.credit_cents AS amount,e.entry_date,e.number,e.memo,e.id AS entry_id,e.source_kind,e.source_id,b.name AS bank,c.name AS contact
      FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id JOIN pt_bank_accounts b ON b.account_id=l.account_id
      LEFT JOIN pt_payments p ON p.journal_id=e.id LEFT JOIN pt_contacts c ON c.id=p.contact_id
      WHERE e.status='posted' AND e.entry_date BETWEEN ? AND ? AND l.debit_cents > l.credit_cents ${dimension?`AND l.${dimension.kind}_name=?`:''} ORDER BY e.entry_date,e.number,l.id`, from, to,...(dimension?[dimension.value]:[]))
    return { basis: 'payment', basisLabel: 'Payment basis', note: 'Every positive posted bank movement in the inclusive range, including receipts, grouped deposits, transfers, interest and reversals. The total is gross bank debits, not net cash flow.',
      columns: ['Date', 'Entry', 'Bank', 'Contact', 'Description', 'Deposit'], moneyColumns: [5],
      rows: rows.map(r => ({ id: r.id, cells: [r.entry_date, r.number, r.bank, r.contact ?? '', r.memo, r.amount], record: `${r.source_kind === 'payment' ? 'payment:' + r.source_id : 'entry:' + r.entry_id}` })),
      totals: [{ label: 'Gross bank deposits', amount: rows.reduce((n,r) => n+r.amount,0) }] }
  }
  const rows = await all(db, `SELECT p.*,SUM(l.credit_cents-l.debit_cents) AS amount_cents, c.name AS contact, b.name AS bank, k.number AS check_number
    FROM pt_payments p JOIN pt_contacts c ON c.id=p.contact_id JOIN pt_bank_accounts b ON b.id=p.bank_account_id LEFT JOIN pt_checks k ON k.payment_id=p.id JOIN pt_journal_lines l ON l.entry_id=p.journal_id AND l.account_id=b.account_id
    WHERE p.payment_date BETWEEN ? AND ? AND p.direction='paid' AND p.method='check' ${dimension?`AND l.${dimension.kind}_name=?`:''} GROUP BY p.id ORDER BY p.payment_date,p.reference,p.id`, from, to,...(dimension?[dimension.value]:[]))
  const reversal = await all(db, 'SELECT id,entry_date FROM pt_journal_entries WHERE source_kind=\'reversal\'')
  const reversed = (r: any) => r.reversal_id && reversal.some(e => e.id === r.reversal_id && e.entry_date <= to)
  return { basis: 'payment', basisLabel: 'Payment basis', note: 'Payments dated within the inclusive range. Reversed payments remain visible; the total excludes reversals effective on or before the end date. Each payment opens its allocations, posted entry and matched bank lines.',
    columns: ['Date', 'Reference', 'Contact', 'Bank', 'Method', 'Status', 'Amount'], moneyColumns: [6],
    rows: rows.map(r => ({ id: r.id, cells: [r.payment_date, String(r.check_number ?? r.reference), r.contact, r.bank, r.method, reversed(r) ? 'Reversed' : 'Recorded', r.amount_cents], record: `payment:${r.id}` })),
    totals: [{ label: 'Unreversed payments', amount: rows.filter(r => !reversed(r)).reduce((n, r) => n + r.amount_cents, 0) }] }
}
