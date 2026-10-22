import { dimensionsView } from '../dimensions'
import { BASIS_LABEL, type Basis } from '../basis'
import { date, monthBounds, requireThat, type Data } from '../core'
import { all } from '../db'
import { generalLedger } from '../reports'
import { budget, monthAt } from './commands'

const rounded = (amount: number, n: number, d: number) => Math.sign(amount) * Number((BigInt(Math.abs(amount)) * BigInt(n) * 2n + BigInt(d)) / (2n * BigInt(d)))
/** A budget cell's share of an inclusive range: its month's amount times the covered calendar days over the month's days, rounded half away from zero to cents. */
export function plannedShare(c: Data, from: string, to: string) {
  const bounds = monthBounds(c.month), start = from > bounds.start ? from : bounds.start, end = to < bounds.end ? to : bounds.end
  if (start > end) return null
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1, monthDays = Number(bounds.end.slice(8))
  return { start, end, days, monthDays, amount: rounded(c.amount_cents, days, monthDays) }
}
export async function budgetReport(db: D1Database, id: string, from: string, to: string, basis: Basis,scope:{dimension?:string;dimensionValue?:string}={}) {
  date(from); date(to); requireThat(from <= to, 'From date must be on or before To date')
  const plan = await budget(db, id)
  requireThat(from >= `${plan.start_month}-01` && to < `${monthAt(plan.start_month, 12)}-01`, 'Choose dates within the budget year')
  const accounts = await all(db, "SELECT id, code, name, type FROM pt_accounts WHERE type IN ('income','expense') ORDER BY code")
  const ledger = await generalLedger(db, from, to, undefined, basis)
  requireThat(!scope.dimension||['class','location'].includes(scope.dimension),'Budget dimension is class or location')
  const field=scope.dimension?`${scope.dimension}_name`:null,value=scope.dimensionValue==='unassigned'?'':scope.dimensionValue?.startsWith('value:')?scope.dimensionValue.slice(6):undefined
  requireThat(!field||value!==undefined,'Choose a dimension value, including Unassigned')
  const selected=(row:Data)=>!field||String(row[field]??'')===value
  const rows = accounts.map(account => {
    const actual = ledger.accounts.find(a => a.id === account.id)?.rows.filter(selected).reduce((sum: number, l: any) => sum + (l.debit_cents - l.credit_cents) * (account.type === 'income' ? -1 : 1), 0) ?? 0
    const planned = plan.cells.filter(c => c.account_id === account.id&&selected(c)).reduce((sum, c) => sum + (plannedShare(c, from, to)?.amount ?? 0), 0)
    const variance = actual - planned
    return { ...account, budget: planned, actual, variance, percent: planned === 0 ? null : rounded(variance, 10000, Math.abs(planned)) / 100 } as Data & { name: string; type: string; budget: number; actual: number; variance: number; percent: number | null }
  }).filter(r => r.actual || r.budget)
  const sum = (type: string, key: 'budget' | 'actual') => rows.filter(r => r.type === type).reduce((n, r) => n + r[key], 0)
  const totals = { budget: sum('income', 'budget') - sum('expense', 'budget'), actual: sum('income', 'actual') - sum('expense', 'actual') }
  const dimensions=await dimensionsView(db),dimensionOptions=['class','location'].flatMap(kind=>{const field=`${kind}_name`,names=[...new Set([...plan.cells.map(c=>String(c[field]??'')),...ledger.accounts.flatMap(a=>a.rows.map((l:Data)=>String(l[field]??'')))])].sort();return names.map(name=>({kind,id:name?'value:'+name:'unassigned',name:name||'Unassigned'}))})
  return { dimension:scope.dimension??null,dimensionValue:scope.dimensionValue??null,dimensionOptions,id, name: plan.name, revision: plan.revision, from, to, basis, budgetBasis: plan.basis, rows, netIncome: { ...totals, variance: totals.actual - totals.budget, percent: totals.budget === 0 ? null : rounded(totals.actual - totals.budget, 10000, Math.abs(totals.budget)) / 100 } }
}
export function budgetCsv(r: Awaited<ReturnType<typeof budgetReport>>) {
  const cell = (s: unknown) => `"${String(s).replaceAll('"', '""')}"`
  return [['Budget', r.name, 'From', r.from, 'To', r.to, BASIS_LABEL[r.basis],...(r.dimension?[r.dimension,r.dimensionValue??'']:[])], ['Account', 'Budget USD', 'Actual USD', 'Variance USD', 'Variance %', 'Basis'], ...[...r.rows, { name: 'Net income', ...r.netIncome }].map(row => [row.name, (row.budget / 100).toFixed(2), (row.actual / 100).toFixed(2), (row.variance / 100).toFixed(2), row.percent ?? 'Not comparable', BASIS_LABEL[r.basis]])].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
