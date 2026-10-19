import { authority, who } from '../access'
import { reportBasis } from '../basis'
import { cents, now, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, one, q, run } from '../db'
import { generalLedger } from '../reports'
import { csvRows } from '../statement-files'
import type { Command } from '../context'

export function monthAt(start: string, offset: number) {
  const [year, month] = start.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7)
}
export function budgetMonth(value: unknown) {
  const m = text(value, 'Budget month', 7)
  requireThat(/^(20\d\d)-(0[1-9]|1[0-2])$/.test(m), 'Budget month must be YYYY-MM in 2000–2099')
  return m
}
export async function budget(db: D1Database, id: string): Promise<Data & { months: string[]; cells: Data[] }> {
  const row = await one(db, 'SELECT * FROM pt_budgets WHERE id = ?', id)
  requireThat(row, 'Budget not found', 404)
  return { ...row, months: Array.from({ length: 12 }, (_, i) => monthAt(row.start_month, i)), cells: await all(db, 'SELECT account_id, month, amount_cents FROM pt_budget_cells WHERE budget_id = ? ORDER BY account_id, month', id) }
}
export async function budgetsView(db: D1Database) {
  return { budgets: await all(db, 'SELECT * FROM pt_budgets ORDER BY created_at, id') }
}
export async function actualCells(db: D1Database, start: string, basis: 'cash' | 'accrual') {
  const ledger = await generalLedger(db, `${start}-01`, `${monthAt(start, 12)}-01`, undefined, basis)
  const cells: Data[] = []
  for (const account of ledger.accounts.filter(a => ['income', 'expense'].includes(a.type))) {
    const monthly = new Map<string, number>()
    for (const line of account.rows) {
      const month = line.entry_date.slice(0, 7)
      if (month < start || month >= monthAt(start, 12)) continue
      monthly.set(month, (monthly.get(month) ?? 0) + (line.debit_cents - line.credit_cents) * (account.type === 'income' ? -1 : 1))
    }
    for (const [month, amount_cents] of monthly) cells.push({ account_id: account.id, month, amount_cents })
  }
  return cells
}
const signedScale = (amount: number, numerator: number) => Number((BigInt(Math.abs(amount)) * BigInt(numerator) * 2n + 10000n) / 20000n) * Math.sign(amount)

const save: Command = { need: 'record', async run(c, b) {
  const name = text(b.name, 'Budget name', 200), start = budgetMonth(b.startMonth), basis = await reportBasis(c.db, b.basis)
  requireThat(!b.classId && !b.locationId, 'Dimensions must be enabled before budgeting by class or location')
  const before = b.id ? await budget(c.db, text(b.id, 'Budget')) : null
  if (before) requireThat(before.revision === b.revision && before.start_month === start, 'Budget changed; reload, and keep its annual start', 409)
  const accounts = await all(c.db, 'SELECT id, code, type, active FROM pt_accounts')
  const byId = new Map(accounts.map(a => [a.id, a])), byCode = new Map(accounts.map(a => [a.code, a]))
  let cells: Data[] = [], source = 'entered'
  if (b.copyActuals) {
    requireThat(!before, 'Copy actuals into a new budget')
    const raw = String(b.percentChange ?? '0')
    requireThat(/^-?\d{1,3}(\.\d{1,2})?$/.test(raw), 'Percentage change needs at most two decimal places')
    const factor = 10000 + cents(raw, 'Percentage change', { signed: true, zero: true })
    requireThat(factor >= 0, 'Percentage change cannot be below -100%')
    cells = (await actualCells(c.db, monthAt(start, -12), basis)).map(cell => ({ ...cell, month: monthAt(cell.month, 12), amount_cents: signedScale(cell.amount_cents, factor) }))
    source = `actuals:${monthAt(start, -12)}:${basis}:${raw}%`
  } else if (b.csv !== undefined) {
    const rows = csvRows(text(b.csv, 'CSV', 1_000_000)), head = rows.shift()?.map(x => x.trim().toLowerCase()) ?? []
    const indices = ['account', 'month', 'amount'].map(k => head.indexOf(k))
    requireThat(indices.every(i => i >= 0), 'CSV columns are Account,Month,Amount; Account is the chart code and Amount is signed USD')
    cells = rows.map((r, i) => {
      const a = byCode.get(r[indices[0]].trim()); requireThat(a, `CSV row ${i + 2}: unknown account code`)
      return { account_id: a.id, month: budgetMonth(r[indices[1]]), amount_cents: cents(r[indices[2]], `Row ${i + 2} amount`, { signed: true, zero: true }) }
    }); source = 'csv'
  } else if (b.easel !== undefined) {
    const plan = b.easel
    requireThat(plan && plan.calculation?.currency === 'USD' && Array.isArray(plan.calculation.cells) && Array.isArray(plan.lines), 'Import a USD Easel scenario response with lines and calculation.cells')
    requireThat(b.mapping && typeof b.mapping === 'object', 'Map every Easel line to a Pantry income or expense account')
    const knownLines = new Set(plan.lines.map((line: Data) => line.id)), aggregate = new Map<string, Data>()
    for (const cell of plan.calculation.cells) {
      requireThat(knownLines.has(cell.line) && Number.isSafeInteger(cell.amount), 'Easel cells must name a known line and integer cents')
      const accountId = b.mapping[cell.line]; requireThat(accountId, `Map Easel line ${cell.line}`)
      const month = budgetMonth(cell.month), key = `${accountId}:${month}`
      const previous = aggregate.get(key)
      aggregate.set(key, { account_id: accountId, month, amount_cents: (previous?.amount_cents ?? 0) + cell.amount })
    }
    cells = [...aggregate.values()]; source = 'easel'
  } else {
    requireThat(Array.isArray(b.cells), 'Enter budget cells')
    cells = b.cells.map((cell: Data) => ({ account_id: cell.accountId, month: budgetMonth(cell.month), amount_cents: cents(cell.amount, 'Budget amount', { signed: true, zero: true }) }))
  }
  requireThat(cells.length <= 2400, 'Keep a budget within 200 accounts and twelve months')
  const keys = new Set<string>()
  for (const cell of cells) {
    const account = byId.get(cell.account_id), key = `${cell.account_id}:${cell.month}`
    requireThat(account && ['income', 'expense'].includes(account.type) && account.active, 'Budget only active income or expense accounts')
    requireThat(cell.month >= start && cell.month < monthAt(start, 12), 'Every budget cell must be within its twelve months')
    requireThat(Number.isSafeInteger(cell.amount_cents) && Math.abs(cell.amount_cents) <= 10_000_000_000_000, 'Budget amount is too large')
    requireThat(!keys.has(key), 'Each account/month occurs once'); keys.add(key)
  }
  const id = before?.id ?? uid(), revision = uid(), at = now()
  await run(c.db, [authority(c.actor, 'record'), ...(before ? [q('UPDATE pt_budgets SET name = ?, basis = ?, source = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?', name, basis, source, revision, at, id, b.revision), changed(), q('DELETE FROM pt_budget_cells WHERE budget_id = ?', id)] : [q('INSERT INTO pt_budgets (id,name,start_month,basis,revision,source,prepared_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', id, name, start, basis, revision, source, c.actor.email, at, at)]),
    ...cells.map(cell => q('INSERT INTO pt_budget_cells (budget_id,account_id,month,amount_cents) VALUES (?,?,?,?)', id, cell.account_id, cell.month, cell.amount_cents)),
    audit(who(c.actor), 'budget.save', 'budget', id, { revision, before, after: { name, start, basis, source, cells } })])
  return budget(c.db, id)
} }
export const budgetCommands = { 'budget.save': save }
