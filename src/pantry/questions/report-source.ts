// Resolve a report question from server data, retaining its scope and figure.
import { basisOf } from '../basis'
import { cashFlowDetail } from '../cash-flow'
import { contractors } from '../contractors'
import { date, requireThat, text } from '../core'
import { one } from '../db'
import { figureDetail } from '../drilldown'
import { trialBalance } from '../reports'
import { salesTax } from '../sales-tax'

export async function reportSource(db: D1Database, id: string) {
  let input; try { input = JSON.parse(id) } catch { requireThat(false, 'Choose a report figure') }
  const report = text(input.report, 'Report', 60), line = text(input.line, 'Report figure', 200)
  const from = date(input.from), to = date(input.to), basis = basisOf(input.basis)
  requireThat(from <= to, 'Report start must be before its end')
  const scope = { report, line, from, to, basis }
  if (report === 'trial-balance' && !line.startsWith('[')) {
    const r = await trialBalance(db, to, basis), a = r.rows.find(a => a.id === line)
    requireThat(a, 'Choose an account on the trial balance', 404)
    return { ...scope, label: `${a.code} ${a.name}`, figure: a.debitBalance - a.creditBalance }
  }
  if (report === 'contractors') {
    requireThat(from === `${to.slice(0, 4)}-01-01` && to.endsWith('-12-31'), 'Choose a calendar tax year')
    const r = await contractors(db, Number(to.slice(0, 4))), c = r.contractors.find(c => c.id === line)
    requireThat(c, 'Choose a contractor on this report', 404)
    return { ...scope, label: `1099 contractor ${c.name} · Box 1`, figure: c.box1 }
  }
  if (report === 'sales-tax') {
    const r = await salesTax(db, from, to, basis)
    const code = r.states.flatMap(s => s.codes).find(c => `code:${c.id}` === line)
    const account = r.ledger.accounts.find(a => `account:${a.id}` === line)
    requireThat(code || account || line === 'exempt' || line === 'total', 'Choose a sales-tax report line', 404)
    return { ...scope, label: code ? `${code.state} · ${code.name} · Tax owed` : account ? `${account.code} ${account.name} · Closing liability` : line === 'exempt' ? 'Exempt sales' : 'Tax owed, all states',
      figure: code?.owed ?? account?.closing ?? (line === 'exempt' ? r.exempt : r.totals.owed) }
  }
  const e = await one(db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
  const d = report === 'cash-flow' ? await cashFlowDetail(db, from, to, line) : await figureDetail(db, scope, Number(e?.fiscal_year_start ?? 1))
  return { ...scope, label: d.label, figure: d.figure }
}
