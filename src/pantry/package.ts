// The accountant package: one period's close evidence as a JSON document, and
// its general ledger as CSV. Every figure is recalculated from the ledger.
import { monthBounds, type Data } from './core'
import { all } from './db'
import { closeState } from './close'
import { ageing, balanceSheet, fiscalYearStart, generalLedger, profitAndLoss, trialBalance } from './reports'
import { requireEntity } from './settings'

export async function accountantPackage(db: D1Database, period: string): Promise<Data> {
  const entity = await requireEntity(db)
  const { start, end } = monthBounds(period)
  return {
    format: 'pantry-accountant-package/1',
    generatedAt: new Date().toISOString(),
    entity: { legalName: entity.legal_name, entityType: entity.entity_type, state: entity.state, currency: entity.currency, bookBasis: entity.book_basis, declaredTaxMethod: entity.tax_method, policies: entity.policies, fiscalYearStart: entity.fiscal_year_start },
    period: { id: period, start, end },
    close: await closeState(db, period),
    trialBalance: await trialBalance(db, end),
    profitAndLoss: { period: await profitAndLoss(db, start, end), yearToDate: await profitAndLoss(db, fiscalYearStart(end, entity.fiscal_year_start), end) },
    balanceSheet: await balanceSheet(db, end, entity.fiscal_year_start),
    receivables: await ageing(db, 'receivable', end),
    payables: await ageing(db, 'payable', end),
    generalLedger: await generalLedger(db, start, end),
    reconciliations: (await all(db, 'SELECT r.*, b.name AS bank FROM pt_reconciliations r JOIN pt_bank_accounts b ON b.id = r.bank_account_id WHERE r.end_date <= ? ORDER BY r.end_date', end)).map(r => ({ ...r, proof: JSON.parse(r.proof) })),
    reversals: await all(db, "SELECT e.id, e.number, e.entry_date, e.memo, e.reverses_id, o.number AS reverses_number FROM pt_journal_entries e JOIN pt_journal_entries o ON o.id = e.reverses_id WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ?", start, end),
    // Approvals carry the time they were given, not a book date: the package holds all of them.
    approvals: await all(db, 'SELECT * FROM pt_approvals ORDER BY at'),
    notes: await all(db, 'SELECT * FROM pt_notes WHERE period = ?', period),
    documents: await all(db, 'SELECT id, name, media_type, size, sha256, linked_kind, linked_id, uploaded_by, uploaded_at FROM pt_documents ORDER BY uploaded_at'),
    cutovers: await all(db, 'SELECT * FROM pt_cutovers'),
  }
}

const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s }
const amount = (c: number) => (c / 100).toFixed(2)

export async function ledgerCsv(db: D1Database, period: string) {
  const { start, end } = monthBounds(period)
  const gl = await generalLedger(db, start, end)
  const rows = [['Account code', 'Account', 'Date', 'Entry', 'Description', 'Line memo', 'Contact', 'Debit', 'Credit', 'Balance']]
  for (const a of gl.accounts) {
    rows.push([a.code, a.name, start, '', 'Opening balance', '', '', '', '', amount(a.opening)])
    for (const l of a.rows) rows.push([a.code, a.name, l.entry_date, String(l.number), l.entry_memo, l.memo, l.contact_name ?? '', l.debit_cents ? amount(l.debit_cents) : '', l.credit_cents ? amount(l.credit_cents) : '', amount(l.running)])
  }
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
