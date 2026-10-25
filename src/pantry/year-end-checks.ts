// Fiscal boundaries and readiness of records Pantry currently holds. These
// checks never claim that an external return or payroll filing was verified.
import { missingW9 } from './w9'
import { all } from './db'
import { contractors } from './contractors'
import { prevDay } from './reports'
import { requireThat, type Data } from './core'

export function yearBounds(year: number, startMonth: number) {
  requireThat(Number.isInteger(year) && year >= 2000 && year <= 9998, 'Choose the year in which the fiscal year ends')
  const firstYear = startMonth === 1 ? year : year - 1
  const start = `${firstYear}-${String(startMonth).padStart(2, '0')}-01`
  const next = `${firstYear + 1}-${String(startMonth).padStart(2, '0')}-01`, end = prevDay(next)
  const periods = Array.from({ length: 12 }, (_, i) => {
    const month = startMonth - 1 + i
    return `${firstYear + Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}`
  })
  return { year, start, end, periods, finalPeriod: end.slice(0, 7) }
}

export const YEAR_END_TASKS = ['Review 1099 classifications and filing readiness', 'Review payroll year-end totals with provider reports']

export async function yearEndChecks(db: D1Database, year: number, startMonth: number) {
  const bounds = yearBounds(year, startMonth)
  // The one calendar year ending in this fiscal year. 1099s always use calendar years.
  const taxYear = Number(bounds.end.slice(0, 4)) - (bounds.end.slice(5) === '12-31' ? 0 : 1)
  const tax = await contractors(db, taxYear)
  const missing = tax.forms.filter(f => !f.ready), unknown = tax.contractors.filter(c => c.unrecorded > 0)
  const payrolls = await all(db, 'SELECT p.*, e.status AS entry_status, e.reversed_by_id FROM pt_gusto_payrolls p LEFT JOIN pt_journal_entries e ON e.id = p.entry_id WHERE p.check_date BETWEEN ? AND ? ORDER BY p.check_date, p.uuid', bounds.start, bounds.end)
  const lines = await all(db, `SELECT l.*, p.uuid FROM pt_journal_lines l JOIN pt_gusto_payrolls p ON p.entry_id = l.entry_id WHERE p.check_date BETWEEN ? AND ?`, bounds.start, bounds.end)
  const payroll: Data[] = payrolls.map(p => {
    const own = lines.filter(l => l.uuid === p.uuid), net = (where: (l: Data) => boolean) => own.filter(where).reduce((sum, l) => sum + l.debit_cents - l.credit_cents, 0)
    const gross = net(l => l.memo === 'Gross wages'), employerTax = net(l => l.memo === 'Employer payroll taxes'), bankDebit = -net(l => l.memo.startsWith('Gusto '))
    return { ...p, journalGross: gross, journalEmployerTax: employerTax, journalDebit: bankDebit,
      ties: p.status === 'booked' && p.entry_status === 'posted' && !p.reversed_by_id && gross === p.gross_cents && employerTax === p.employer_tax_cents && bankDebit === p.debit_cents && net(() => true) === 0 }
  })
  const totals = { gross: 0, employerTax: 0, withheld: 0, net: 0, debit: 0 }
  for (const p of payroll) { totals.gross += p.gross_cents; totals.employerTax += p.employer_tax_cents; totals.withheld += p.withheld_cents; totals.net += p.net_cents; totals.debit += p.debit_cents }
  const w9 = await missingW9(db,taxYear)
  const checks = [
    {key:'year-end-w9',title:'Paid vendors without a W-9',ok:w9.length===0,detail:`${w9.length} paid vendors lack a certified W-9. Review classification with the accountant.`,items:w9.map(v=>({kind:'vendor',id:v.id,label:`${v.name}: W-9 ${v.w9.status}`}))},
    { key: 'year-end-1099', title: `1099 readiness · calendar ${taxYear}`, ok: missing.length === 0 && unknown.length === 0 && tax.otherBoxes.length === 0 && !tax.contractors.some(c => c.backupWithholding),
      detail: `${tax.forms.length} forms; ${missing.length} missing TIN and address; ${unknown.length} contractors with unknown payment methods; ${tax.unmarked.length} paid vendors to review for classification. ${tax.otherBoxes.length} vendors use a MISC box requiring separate filing review; ${tax.contractors.filter(c => c.backupWithholding).length} backup-withholding flags require review. Filing and recipient delivery are not verified here.`,
      items: [...tax.otherBoxes.map(c => ({ kind: 'vendor', id: c.id, label: `${c.name}: ${c.taxBox} needs separate filing review` })), ...tax.contractors.filter(c => c.backupWithholding).map(c => ({ kind: 'vendor', id: c.id, label: `${c.name}: review backup withholding` })), ...missing.map(f => ({ kind: 'vendor', id: f.id, label: `${f.name}: missing filing details` })), ...unknown.map(c => ({ kind: 'vendor', id: c.id, label: `${c.name}: payment methods unknown` }))] },
    { key: 'year-end-payroll', title: 'Payroll year-end totals tied to journals', ok: payroll.every(p => p.ties),
      detail: payroll.length ? `${payroll.length} imported Gusto payrolls; ${payroll.filter(p => !p.ties).length} held, reversed or not tied. Compare these recorded totals with the provider’s year-end reports; no external filing is certified.` : 'No imported payroll records in this fiscal year. Review any payroll outside Pantry against provider reports; this is not verification that no payroll occurred.',
      items: payroll.filter(p => !p.ties).map(p => ({ kind: 'gusto-payroll', id: p.uuid, label: p.reason || 'Posted payroll does not tie to its imported totals' })) },
  ]
  return { ...bounds, taxYear, tax, payroll, payrollTotals: totals, checks }
}
