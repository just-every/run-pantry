// One Gusto payroll as one balanced journal entry, from the payroll's totals.
// Wages, employer taxes, company benefits and reimbursements are the cost;
// what Gusto debits from the bank (net pay, taxes withheld from employees and
// the employer's taxes, reimbursements, child support) comes out of the bank in
// lines grouped by debit, so each debit can be matched; what the business still
// owes others (paper checks, benefit and other deductions, deferred taxes) is a
// payroll liability. Totals that do not add up are held for a person.
import type { Totals } from './client'

export type Role = 'wages' | 'taxes' | 'benefits' | 'reimbursements' | 'bank' | 'liabilities'
export type PayrollLine = { role: Role; signed: number; memo: string }
export type PayrollEntry = { ok: boolean; reason: string; gross: number; employerTaxes: number; withheld: number; net: number; debit: number; lines: PayrollLine[] }

const FIELDS = ['gross_pay', 'net_pay', 'employer_taxes', 'employee_taxes', 'benefits', 'employee_benefits_deductions', 'other_deductions', 'reimbursements', 'check_amount',
  'company_debit', 'net_pay_debit', 'tax_debit', 'reimbursement_debit', 'child_support_debit', 'deferred_payroll_taxes'] as const

const cents = (v: string | null | undefined) => {
  if (v === null || v === undefined || v === '') return 0
  return /^-?\d+(\.\d{1,2})?$/.test(String(v).trim()) ? Math.round(Number(v) * 100) : NaN
}
const dollars = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`

export function payrollEntry(totals: Totals | undefined): PayrollEntry {
  const t = Object.fromEntries(FIELDS.map(f => [f, cents(totals?.[f])])) as Record<typeof FIELDS[number], number>
  const withheld = t.employee_taxes + t.employee_benefits_deductions + t.other_deductions
  const out: PayrollEntry = { ok: false, reason: '', gross: t.gross_pay, employerTaxes: t.employer_taxes, withheld, net: t.net_pay, debit: t.company_debit, lines: [] }
  const hold = (reason: string) => ({ ...out, ok: false, reason })
  if (!totals) return hold('Gusto sent this payroll without its totals; post it by hand.')
  const bad = FIELDS.filter(f => Number.isNaN(t[f]))
  if (bad.length) return hold(`Gusto's ${bad.join(', ')} for this payroll is not an amount; post it by hand.`)
  if (t.gross_pay <= 0) return hold('This payroll has no gross pay to post.')
  const otherWithheld = t.other_deductions - t.child_support_debit
  if (otherWithheld < 0) return hold(`Gusto debits ${dollars(t.child_support_debit)} of child support but reports only ${dollars(t.other_deductions)} of deductions; post it by hand.`)
  if (t.employee_taxes + t.employer_taxes - t.deferred_payroll_taxes !== t.tax_debit) return hold(`Gusto's tax debit of ${dollars(t.tax_debit)} is not the employee and employer taxes less any deferred; post it by hand.`)
  if (t.net_pay_debit + t.tax_debit + t.reimbursement_debit + t.child_support_debit !== t.company_debit) return hold(`Gusto's debits do not add up to its company debit of ${dollars(t.company_debit)}; post it by hand.`)
  const lines = ([
    { role: 'wages', signed: t.gross_pay, memo: 'Gross wages' },
    { role: 'taxes', signed: t.employer_taxes, memo: 'Employer payroll taxes' },
    { role: 'benefits', signed: t.benefits, memo: 'Company benefit contributions' },
    { role: 'reimbursements', signed: t.reimbursements, memo: 'Employee reimbursements' },
    { role: 'bank', signed: -t.net_pay_debit, memo: 'Gusto net pay debit · net pay by direct deposit' },
    { role: 'bank', signed: -t.employee_taxes, memo: 'Gusto tax debit · taxes withheld from employees' },
    { role: 'bank', signed: -(t.employer_taxes - t.deferred_payroll_taxes), memo: `Gusto tax debit · employer payroll taxes${t.deferred_payroll_taxes ? ' not deferred' : ''}` },
    { role: 'bank', signed: -t.reimbursement_debit, memo: 'Gusto reimbursement debit · reimbursements by direct deposit' },
    { role: 'bank', signed: -t.child_support_debit, memo: 'Gusto child support debit · child support Gusto pays' },
    { role: 'liabilities', signed: -t.check_amount, memo: 'Net pay by paper check, to be paid' },
    { role: 'liabilities', signed: -t.employee_benefits_deductions, memo: 'Benefit deductions withheld, owed to providers' },
    { role: 'liabilities', signed: -t.benefits, memo: 'Company benefit contributions, owed to providers' },
    { role: 'liabilities', signed: -otherWithheld, memo: 'Other deductions withheld, owed to others' },
    { role: 'liabilities', signed: -t.deferred_payroll_taxes, memo: 'Payroll taxes deferred' },
  ] satisfies PayrollLine[]).filter(l => l.signed !== 0)
  const off = lines.reduce((s, l) => s + l.signed, 0)
  if (off !== 0) return hold(`Gusto's totals for this payroll are ${dollars(off)} out of balance (gross pay ${dollars(t.gross_pay)} is not net pay, withholdings and deductions); post it by hand.`)
  return { ...out, ok: true, lines }
}
