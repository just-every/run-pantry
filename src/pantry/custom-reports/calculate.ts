import { BASIS_LABEL, reportBasis } from '../basis'
import { date, requireThat, text, type Data } from '../core'
import { all, one } from '../db'
import { balanceSheet, fiscalYearStart, prevDay, profitAndLoss, trialBalance } from '../reports'
import { contactTotals } from '../contact-totals'
import { statementColumns } from '../statement-columns'
import { addFormulaValues, compileFormula, exactFormulaValue, roundFormula, type FormulaExact } from './formula'
import type { AccountSelection, CalculatedCustomReport, CalculatedCustomReportRow, CustomReportColumn, CustomReportDefinition, CustomReportLayoutRow, CustomReportDrillGraph, CustomReportDrillNode } from './types'

const SOURCES = ['profit-and-loss', 'balance-sheet', 'trial-balance', 'sales-by-customer', 'expenses-by-vendor']
const COMPARISONS = ['single', 'prior-period', 'prior-year', 'months', 'quarters', 'ytd', 'customer']
const TYPES = ['asset', 'liability', 'equity', 'income', 'expense']
type Account = { id: string; code: string; name: string; type: string }
type SourceLine = { id: string; accountId?: string; contactId?: string; code: string; name: string; type: string; section: string; amount: number }
type MatrixLine = Omit<SourceLine, 'amount'> & { amounts: Record<string, number> }
const selected = (line: { accountId?: string; type: string }, selection?: AccountSelection) =>
  (!selection?.accountIds || !!line.accountId && selection.accountIds.includes(line.accountId)) && (!selection?.accountTypes || selection.accountTypes.includes(line.type))
const isStatement = (source: string): source is 'profit-and-loss' | 'balance-sheet' => source === 'profit-and-loss' || source === 'balance-sheet'
const isContact = (source: string) => source === 'sales-by-customer' || source === 'expenses-by-vendor'
const sectionOf = (type: string) => ({ asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' } as Record<string, string>)[type]
const safe = (value: number) => { requireThat(Number.isSafeInteger(value), 'Report amount is too large'); return value }
const sum = (values: number[]) => safe(values.reduce((total, value) => total + value, 0))
const percentage = (numerator: number, denominator: number, numeratorExact?: FormulaExact | null, denominatorExact?: FormulaExact | null) => compileFormula('row("n") / row("d") * 100', 'percent')({ row: id => ({ value: id === 'n' ? numerator : denominator, exact: id === 'n' ? numeratorExact : denominatorExact, unit: 'money' }), account: () => { throw new Error('Unexpected account reference') } })

/** Validate saved definitions before any storage, without accepting calculated totals. */
export function validateCustomReportDefinition(value: unknown): CustomReportDefinition {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Report definition is required')
  const d = value as CustomReportDefinition
  const strings = (values: unknown, label: string, max = 500) => {
    if (values === undefined) return
    requireThat(Array.isArray(values) && values.length > 0 && values.length <= max, `${label} needs 1–${max} items`)
    for (const value of values) text(value, label, 200)
    requireThat(new Set(values).size === values.length, `${label} cannot repeat items`)
  }
  const selection = (s?: AccountSelection) => {
    if (s === undefined) return
    requireThat(s && typeof s === 'object' && !Array.isArray(s), 'Account filters must be an object')
    strings(s.accountIds, 'Account IDs'); strings(s.accountTypes, 'Account types', 5)
    requireThat(!s.accountTypes || s.accountTypes.every(type => TYPES.includes(type)), 'Choose valid account types')
  }
  const name = text(d.name, 'Report name', 200), from = date(d.from, 'From'), to = date(d.to, 'To')
  requireThat(from <= to, 'From must be on or before To')
  requireThat(SOURCES.includes(d.source), 'Choose a supported financial report source')
  requireThat(d.basis === undefined || d.basis === 'cash' || d.basis === 'accrual', 'Basis is cash or accrual')
  requireThat(d.grouping === undefined || ['account', 'section', 'customer'].includes(d.grouping), 'Choose account, section or customer grouping')
  requireThat(d.comparison === undefined || COMPARISONS.includes(d.comparison), 'Choose supported report columns')
  requireThat(!d.comparison || d.comparison === 'single' || isStatement(d.source), 'Comparison columns require profit and loss or balance sheet')
  requireThat(d.comparison !== 'customer' || d.source === 'profit-and-loss', 'Customer columns require profit and loss')
  requireThat(d.grouping !== 'customer' || d.source === 'profit-and-loss' || isContact(d.source), 'Customer grouping is unavailable for this source')
  selection(d.filters); strings(d.filters?.contactIds, 'Contact IDs')
  requireThat(!d.filters?.contactIds || d.source === 'profit-and-loss' || isContact(d.source), 'Contact filters are unavailable for this source')
  requireThat(!isContact(d.source) || !d.filters?.accountIds && !d.filters?.accountTypes, 'Contact summaries do not support account filters; use profit and loss')
  strings(d.columns, 'Columns', 100)
  requireThat(d.allColumns === undefined || typeof d.allColumns === 'boolean', 'All columns must be a boolean')
  requireThat(!d.allColumns || d.columns === undefined, 'Choose all columns or a selected list, not both')
  if (d.notes !== undefined) {
    requireThat(Array.isArray(d.notes) && d.notes.length <= 100, 'Report supports up to 100 notes')
    d.notes.forEach(note => text(note, 'Note', 10000))
  }
  if (d.layout !== undefined) {
    requireThat(Array.isArray(d.layout) && d.layout.length > 0 && d.layout.length <= 200, 'Layout needs 1–200 rows')
    const earlier = new Set<string>()
    for (const row of d.layout) {
      requireThat(row && typeof row === 'object', 'Layout row is required')
      const id = text(row.id, 'Layout row ID', 200)
      requireThat(!earlier.has(id), 'Layout row IDs must be unique')
      requireThat(['accounts', 'section', 'formula', 'note'].includes(row.kind), 'Choose an account, section, formula or note row')
      if (row.kind === 'accounts' || row.kind === 'section') {
        selection(row)
        requireThat(!isContact(d.source) || !row.accountIds && !row.accountTypes, 'Contact summaries do not support account selection')
        if (row.label !== undefined) text(row.label, 'Row label', 500)
      }
      if (row.kind === 'section') {
        text(row.label, 'Section label', 500); strings(row.rowIds, 'Subtotal rows', 200)
        requireThat(!row.rowIds || row.rowIds.every(id => earlier.has(id)), 'Sections can reference only earlier layout rows')
        requireThat(!row.rowIds || !row.accountIds && !row.accountTypes, 'Choose either row references or account filters for a section')
      }
      if (row.kind === 'formula') {
        text(row.label, 'Formula label', 500); compileFormula(row.expression, row.unit)
      }
      if (row.kind === 'note') text(row.text, 'Note', 10000)
      earlier.add(id)
    }
  }
  return { ...d, name, from, to, ...(d.id === undefined ? {} : { id: text(d.id, 'Report ID', 200) }) }
}

async function sourceLines(db: D1Database, d: CustomReportDefinition, from: string, to: string, basis: 'cash' | 'accrual', startMonth: number, accounts: Map<string, Account>, contactColumn?: string): Promise<SourceLine[]> {
  let rows: SourceLine[]
  const financial = (a: Data, section: string): SourceLine => ({ id: a.id, accountId: a.id, code: a.code, name: a.name, type: a.type, section, amount: a.amount })
  if (d.source === 'profit-and-loss' && (d.filters?.contactIds || d.grouping === 'customer' || contactColumn)) {
    const matrix = await statementColumns(db, 'profit-and-loss', 'customer', from, to, startMonth, basis)
    const contacts = matrix.columns.map((column, index) => ({ ...column, index })).filter(c => c.id !== 'total' && (!contactColumn || contactColumn === 'total' || c.id === contactColumn) && (!d.filters?.contactIds || d.filters.contactIds.includes(c.id)))
    rows = matrix.rows.flatMap(a => contacts.map(c => ({ id: `${a.id}:${c.id}`, accountId: a.id, contactId: c.id, code: a.code, name: a.name, type: accounts.get(a.id)?.type ?? '', section: a.section, amount: a.values[c.index] ?? 0 })))
  } else if (d.source === 'profit-and-loss') {
    const r = await profitAndLoss(db, from, to, basis)
    rows = [...r.income.map(a => financial(a, 'Income')), ...r.expenses.map(a => financial(a, 'Expenses'))]
  } else if (d.source === 'balance-sheet') {
    const r = await balanceSheet(db, to, startMonth, basis)
    rows = [...r.assets.map(a => financial(a, 'Assets')), ...r.liabilities.map(a => financial(a, 'Liabilities')), ...r.equity.map(a => financial(a, 'Equity'))]
  } else if (d.source === 'trial-balance') {
    rows = (await trialBalance(db, to, basis)).rows.map(a => ({ ...financial({ ...a, amount: a.net }, sectionOf(a.type)), amount: a.net }))
  } else {
    const kind = d.source === 'sales-by-customer' ? 'customer' : 'vendor'
    rows = (await contactTotals(db, kind, from, to, basis)).rows.map(a => ({ id: a.id, contactId: a.id, code: '', name: a.name, type: kind === 'customer' ? 'income' : 'expense', section: kind === 'customer' ? 'Sales' : 'Expenses', amount: a.amount }))
    if (d.filters?.contactIds) rows = rows.filter(a => d.filters!.contactIds!.includes(a.contactId!))
  }
  return rows.filter(a => selected(a, d.filters)).map(a => ({ ...a, amount: safe(a.amount) }))
}

/** Reads native reports on the declared/default basis; nothing accepts stored totals. */
export async function calculateCustomReport(db: D1Database, definition: CustomReportDefinition, drills?: CustomReportDrillGraph): Promise<CalculatedCustomReport> {
  const d = validateCustomReportDefinition(definition)
  const [basis, entity, chart, contacts] = await Promise.all([reportBasis(db, d.basis), one(db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1'), all<Account>(db, 'SELECT id, code, name, type FROM pt_accounts ORDER BY code'), all<{ id: string; name: string }>(db, 'SELECT id, name FROM pt_contacts')])
  const accounts = new Map(chart.map(a => [a.id, a])), contactNames = new Map(contacts.map(c => [c.id, c.name]))
  const checkSelection = (selection?: AccountSelection) => {
    for (const id of selection?.accountIds ?? []) requireThat(accounts.has(id) || d.source === 'balance-sheet' && ['prior-earnings', 'current-earnings'].includes(id), `Unknown account ${id}`)
  }
  checkSelection(d.filters)
  for (const row of d.layout ?? []) if (row.kind === 'accounts' || row.kind === 'section') checkSelection(row)
  for (const id of d.filters?.contactIds ?? []) requireThat(contactNames.has(id) || id === 'unassigned', `Unknown contact ${id}`)
  const startMonth = Number(entity?.fiscal_year_start ?? 1)
  const available: CustomReportColumn[] = [{ id: 'code', label: 'Code', unit: 'text' }, { id: 'name', label: 'Name', unit: 'text' }, { id: 'amount', label: d.source === 'trial-balance' ? 'Net (debit positive / credit negative) · USD' : 'Amount · USD', unit: 'money', from: d.from, to: d.to }]
  const snapshots = new Map<string, SourceLine[]>()
  snapshots.set('amount', await sourceLines(db, d, d.from, d.to, basis, startMonth, accounts))
  const comparison = d.comparison ?? 'single'
  if (comparison !== 'single' && isStatement(d.source)) {
    const native = await statementColumns(db, d.source, comparison, d.from, d.to, startMonth, basis)
    for (const column of native.columns.filter(c => c.unit === 'money' && c.id !== 'change')) {
      available.push({ ...column, label: `${column.label} · USD` })
      snapshots.set(column.id, await sourceLines(db, d, column.from, column.to, basis, startMonth, accounts, comparison === 'customer' ? column.id : undefined))
    }
    if (comparison === 'prior-period' || comparison === 'prior-year') available.push({ id: 'change', label: 'Change · USD', unit: 'money' }, { id: 'percent', label: 'Change (%)', unit: 'percent' })
  }
  available.push({ id: 'share', label: 'Share of absolute amounts (%)', unit: 'percent' })
  const wanted = d.allColumns ? available.map(column => column.id) : d.columns ?? ['code', 'name', 'amount']
  for (const id of wanted) requireThat(available.some(column => column.id === id), `Column ${id} is unavailable for this report`)
  const columns = wanted.map(id => available.find(column => column.id === id)!)
  const matrix = new Map<string, MatrixLine>()
  for (const [column, lines] of snapshots) for (const { amount, ...line } of lines) {
    const existing = matrix.get(line.id) ?? { ...line, amounts: {} }
    existing.amounts[column] = amount; matrix.set(line.id, existing)
  }
  const allLines = [...matrix.values()].filter(line => Object.values(line.amounts).some(amount => amount !== 0))
  const moneyColumns = [...snapshots.keys()]
  const denominator = sum((snapshots.get('amount') ?? []).map(line => Math.abs(line.amount)))
  const drillKey = (row: string, column: string) => JSON.stringify(['row', row, column])
  const drillRange = (column: string) => {
    const c = available.find(c => c.id === column)
    return { from: ['balance-sheet', 'trial-balance'].includes(d.source) ? null : c?.from ?? d.from, to: c?.to ?? d.to }
  }
  const putDrill = (key: string, node: CustomReportDrillNode) => { drills?.nodes.set(key, node); return key }
  const sourceDrill = (key: string, label: string, column: string, lines: MatrixLine[], value: number | null) => {
    const range = drillRange(column), sourceTo = range.to
    const members = lines.filter(line => column in line.amounts)
    if (d.source === 'balance-sheet' && members.length === 1) {
      const fy = fiscalYearStart(range.to, startMonth)
      if (members[0].accountId === 'current-earnings') range.from = fy
      if (members[0].accountId === 'prior-earnings') range.to = prevDay(fy)
    }
    return putDrill(key, { label, value, unit: 'money', ...range, sourceTo, operands: [],
      origins: members.map(line => ({ accountId: line.accountId, contactId: line.contactId, type: line.type, value: line.amounts[column] ?? 0 })),
    })
  }
  const denominatorKey = JSON.stringify(['denominator'])
  if (drills) putDrill(denominatorKey, { label: 'Sum of absolute source amounts', value: denominator, unit: 'money', ...drillRange('amount'),
    expression: 'sum(abs(each source amount))', operands: (snapshots.get('amount') ?? []).map((line, index) => sourceDrill(JSON.stringify(['denominator', index]), `${line.code ? line.code + ' · ' : ''}${line.name}${line.contactId ? ' · ' + (contactNames.get(line.contactId) ?? 'Unassigned') : ''}`, 'amount', [{ ...line, amounts: { amount: line.amount } }], line.amount)) })
  const aggregate = (lines: MatrixLine[]) => Object.fromEntries(moneyColumns.map(column => [column, sum(lines.map(line => line.amounts[column] ?? 0))])) as Record<string, number | null>
  type NumericRow = { values: Record<string, number | null>; exact?: Record<string, FormulaExact | null>; unit: 'money' | 'ratio' | 'percent' }
  const numericRows = new Map<string, NumericRow>()
  const output: CalculatedCustomReportRow[] = [], earlierLayout = new Set<string>()
  const emit = (id: string, kind: CalculatedCustomReportRow['kind'], code: string, name: string, amounts: Record<string, number | null>, unit: 'money' | 'ratio' | 'percent' = 'money', exact?: Record<string, FormulaExact | null>) => {
    const values: Record<string, number | string | null> = { ...amounts, code, name }
    if (comparison === 'prior-period' || comparison === 'prior-year') {
      const change = compileFormula('row("current") - row("prior")', unit).exact({ row: id => ({ value: amounts[id] ?? null, exact: exact?.[id], unit }), account: () => { throw new Error('Unexpected account reference') } })
      const prior = exactFormulaValue({ value: amounts.prior ?? null, exact: exact?.prior, unit })
      const absolutePrior = prior && { ...prior, numerator: prior.numerator < 0n ? -prior.numerator : prior.numerator }
      values.change = roundFormula(change, unit)
      values.percent = percentage(0, 0, change, absolutePrior)
    }
    values.share = unit === 'money' && amounts.amount !== null ? percentage(amounts.amount ?? 0, denominator, exact?.amount) : null
    if (drills) {
      const changeKey = drillKey(id, 'change'), priorKey = drillKey(id, 'prior'), absoluteKey = JSON.stringify(['absolute-prior', id])
      const prior = drills.nodes.get(priorKey)
      if (comparison === 'prior-period' || comparison === 'prior-year') {
        putDrill(changeKey, { label: `${name} · Change`, value: values.change as number | null, unit, ...drillRange('change'), expression: 'current - prior', operands: [drillKey(id, 'current'), priorKey], exact: compileFormula('row("current") - row("prior")', unit).exact({ row: ref => ({ value: amounts[ref] ?? null, exact: exact?.[ref], unit }), account: () => { throw new Error('Unexpected account reference') } }) })
        const exactPrior = prior?.exact
        putDrill(absoluteKey, { label: `${name} · Absolute prior`, value: prior?.value === null || prior?.value === undefined ? null : Math.abs(prior.value), unit, ...drillRange('prior'), expression: 'abs(prior)', operands: [priorKey], exact: exactPrior && { ...exactPrior, numerator: exactPrior.numerator < 0n ? -exactPrior.numerator : exactPrior.numerator } })
        putDrill(drillKey(id, 'percent'), { label: `${name} · Change (%)`, value: values.percent as number | null, unit: 'percent', ...drillRange('percent'), expression: '(current - prior) / abs(prior) * 100', operands: [changeKey, absoluteKey] })
      }
      putDrill(drillKey(id, 'share'), { label: `${name} · Share (%)`, value: values.share as number | null, unit: 'percent', ...drillRange('amount'), expression: 'amount / sum(abs(each source amount)) * 100', operands: [drillKey(id, 'amount'), denominatorKey] })
      for (const column of columns.filter(c => c.unit !== 'text')) drills.roots.set(JSON.stringify([id, column.id]), drillKey(id, column.id))
    }
    output.push({ id, kind, code, name, unit, values })
    numericRows.set(id, { values: amounts, unit, exact })
  }
  const group = (lines: MatrixLine[], prefix: string) => {
    const groups = new Map<string, MatrixLine[]>()
    for (const line of lines) {
      const key = d.grouping === 'section' ? line.section : d.grouping === 'customer' ? line.contactId! : line.accountId ?? line.id
      const members = groups.get(key) ?? []; members.push(line); groups.set(key, members)
    }
    for (const [key, members] of groups) {
      const first = members[0], name = d.grouping === 'section' ? key : d.grouping === 'customer' ? contactNames.get(key) ?? (key === 'unassigned' ? 'Unassigned' : first.name) : first.name
      if (drills) for (const column of moneyColumns) sourceDrill(drillKey(`${prefix}:${key}`, column), name, column, members, aggregate(members)[column])
      emit(`${prefix}:${key}`, d.grouping === 'section' ? 'section' : 'account', d.grouping === 'section' || d.grouping === 'customer' ? '' : first.code, name, aggregate(members))
    }
  }
  for (const row of d.layout ?? [{ id: 'accounts', kind: 'accounts' } as CustomReportLayoutRow]) {
    if (row.kind === 'note') { output.push({ id: row.id, kind: 'note', code: '', name: '', unit: 'money', values: {}, text: row.text }); continue }
    if (row.kind === 'accounts' || row.kind === 'section') {
      const lines = allLines.filter(line => selected(line, row))
      let values = aggregate(lines)
      let exact: Record<string, FormulaExact | null> | undefined
      if (row.kind === 'section' && row.rowIds) {
        const referenced = row.rowIds.map(id => { const value = numericRows.get(id); requireThat(value && value.unit === 'money', 'Section subtotals require earlier money rows'); return value })
        exact = Object.fromEntries(moneyColumns.map(column => [column, referenced.reduce<FormulaExact | null>((total, row) => addFormulaValues(total, exactFormulaValue({ value: row.values[column] ?? null, exact: row.exact?.[column], unit: row.unit })), exactFormulaValue({ value: 0, unit: 'money' }))]))
        values = Object.fromEntries(moneyColumns.map(column => [column, roundFormula(exact![column], 'money')]))
      }
      if (drills) for (const column of moneyColumns) {
        const key = drillKey(row.id, column), label = row.label ?? row.id
        if (row.kind === 'section' && row.rowIds) putDrill(key, { label, value: values[column], unit: 'money', ...drillRange(column), exact: exact?.[column], expression: row.rowIds.map(id => `row(${JSON.stringify(id)})`).join(' + '), operands: row.rowIds.map(id => drillKey(id, column)) })
        else sourceDrill(key, label, column, lines, values[column])
        if (row.kind === 'accounts' && row.label) drills.nodes.set(drillKey(`${row.id}:heading`, column), drills.nodes.get(key)!)
      }
      numericRows.set(row.id, { values, unit: 'money', exact })
      if (row.kind === 'accounts') { if (row.label) emit(`${row.id}:heading`, 'section', '', row.label, values); group(lines, row.id) }
      else emit(row.id, 'section', '', row.label, values, 'money', exact)
    } else {
      const formula = compileFormula(row.expression, row.unit)
      const formulaOperands = new Map(moneyColumns.map(column => [column, [] as string[]]))
      const exact = Object.fromEntries(moneyColumns.map(column => [column, formula.exact({
        row: id => { const value = numericRows.get(id); requireThat(earlierLayout.has(id) && value, `Formula references unknown or later row ${id}`); if (drills) formulaOperands.get(column)!.push(drillKey(id, column)); return { value: value.values[column] ?? null, unit: value.unit, exact: value.exact?.[column] } },
        account: id => {
          requireThat(!isContact(d.source), 'Contact summaries do not support account formula references')
          requireThat(accounts.has(id) || d.source === 'balance-sheet' && ['prior-earnings', 'current-earnings'].includes(id), `Unknown formula account ${id}`)
          const account = accounts.get(id) ?? { type: 'equity' }
          requireThat((d.source !== 'profit-and-loss' || ['income', 'expense'].includes(account.type)) && (d.source !== 'balance-sheet' || ['asset', 'liability', 'equity'].includes(account.type)), 'Formula account is outside this report source')
          requireThat(selected({ accountId: id, type: account.type }, d.filters), 'Formula account is excluded by report filters')
          const lines: MatrixLine[] = (snapshots.get(column) ?? []).filter(line => line.accountId === id).map(({ amount, ...line }) => ({ ...line, amounts: { [column]: amount } }))
          const value = sum(lines.map(line => line.amounts[column] ?? 0))
          if (!lines.length && !(d.source === 'profit-and-loss' && (d.filters?.contactIds || d.grouping === 'customer' || comparison === 'customer' && column !== 'amount'))) {
            const account = accounts.get(id)
            lines.push({ id, accountId: id, code: account?.code ?? '', name: account?.name ?? id, type: account?.type ?? 'equity', section: sectionOf(account?.type ?? 'equity'), amounts: { [column]: 0 } })
          }
          if (drills) formulaOperands.get(column)!.push(sourceDrill(JSON.stringify(['account', id, column]), accounts.get(id)?.name ?? id, column, lines, value))
          return { value, unit: 'money' }
        },
      })]))
      const values = Object.fromEntries(moneyColumns.map(column => [column, roundFormula(exact[column], row.unit)]))
      if (drills) for (const column of moneyColumns) putDrill(drillKey(row.id, column), { label: row.label, value: values[column], unit: row.unit, ...drillRange(column), expression: row.expression, exact: exact[column], operands: formulaOperands.get(column)! })
      emit(row.id, 'formula', '', row.label, values, row.unit, exact)
    }
    earlierLayout.add(row.id)
  }
  const range = ['balance-sheet', 'trial-balance'].includes(d.source) ? `As of ${d.to}` : `${d.from} to ${d.to}`
  return { id: d.id ?? '', name: d.name, source: d.source, basis, basisLabel: BASIS_LABEL[basis], from: d.from, to: d.to, range, columns, rows: output, notes: d.notes ?? [] }
}
