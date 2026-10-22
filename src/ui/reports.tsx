// Reports, all from the same ledger, on the cash or accrual basis, and the
// accountant package download. Every figure on the statements, ledgers, grouped,
// comparison, budget and 1099 reports opens to the records behind it (report-detail.tsx).
import { useEffect } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Card, Chip, Field, Loading, PageHead, Table, Tabs, day, monthName, today, usd, useShared, useView, type D } from './kit'
import { BASIS_NAME, FigureDetail, RecordView } from './report-detail'
import { Budgets } from './budgets'
import { CustomReports } from './custom-reports'
import { customReportsOnly } from './role-navigation'
import { SalesTax } from './sales-tax'
import { Contractors } from './contractors'
import { CashFlow, CashFlowDetail } from './cash-flow'
import { AskAccountant } from './ask-accountant'
import { ColumnPicker, StatementColumns, columnMode, type ColumnMode, type ColumnStatement } from './statement-columns'
import { LIBRARY_REPORTS, ReportLibrary, hasLibraryFilters, isLibraryReport, libraryBasisLabel, libraryQuery } from './report-library'

export type ReportSearch = { report?: string; basis?: string; from?: string; to?: string; line?: string; record?: string; year?: string; columns?: string; account?: string; payee?: string; customId?: string; row?: string; column?: string; node?: string; origin?: string; budget?: string;dimension?:string;dimensionValue?:string }
type Basis = 'cash' | 'accrual'

// [tab, slug, reads on a basis, takes a date range]
const KINDS: [string, string, boolean, boolean][] = [['Trial balance', 'trial-balance', true, false], ['General ledger', 'general-ledger', true, true], ['Profit and loss', 'profit-and-loss', true, true], ['Balance sheet', 'balance-sheet', true, false],
  ['Sales by customer', 'sales-by-customer', true, true], ['Sales by item', 'sales-by-item', true, true], ['Expenses by vendor', 'expenses-by-vendor', true, true], ['Cash flow', 'cash-flow', false, true], ['Receivables aging', 'receivables', false, false], ['Payables aging', 'payables', false, false], ['Sales tax by state', 'sales-tax', true, true], ['1099 contractors', 'contractors', false, false], ['Budget versus actual', 'budget-actual', true, true], ['Custom reports', 'custom', false, false], ...LIBRARY_REPORTS]

/** A figure that opens to its records. */
function Figure({ line, children }: { line: string; children: React.ReactNode }) {
  const search = useSearch({ from: '/app/reports' })
  return <Link to="/app/reports" search={{ ...search, line, record: undefined }} className="figure-link">{children}</Link>
}

function Trial({ r, from, to, basis }: { r: D; from: string; to: string; basis: Basis }) {
  return <Table heads={['Code', 'Account', 'Debit', 'Credit']} figures={[2, 3]} empty="No posted balances on this date.">
    {[...r.rows.map((x: D) => <tr key={x.id}><td>{x.code}</td><td>{x.name}<AskAccountant key={JSON.stringify({ from, to, basis })} subjectKind="report-line" subjectId={JSON.stringify({ report: 'trial-balance', line: x.id, from, to, basis })} label={`Trial balance · ${x.code} · ${x.name} · ${to} · ${BASIS_NAME[basis]}`} /></td><td className="fig">{x.debitBalance ? <Figure line={JSON.stringify([x.id, 'debit'])}>{usd(x.debitBalance)}</Figure> : ''}</td><td className="fig">{x.creditBalance ? <Figure line={JSON.stringify([x.id, 'credit'])}>{usd(x.creditBalance)}</Figure> : ''}</td></tr>),
      <tr key="total" className="total"><td /><td>Total {r.balanced ? '' : '(out of balance)'}</td><td className="fig"><Figure line={JSON.stringify(['total', 'debit'])}>{usd(r.debit)}</Figure></td><td className="fig"><Figure line={JSON.stringify(['total', 'credit'])}>{usd(r.credit)}</Figure></td></tr>]}
  </Table>
}

function Ledger({ r }: { r: D }) {
  return <>{r.accounts.length ? r.accounts.map((a: D) => <div key={a.id} className="gl-account"><h3>{a.code} · {a.name}</h3>
    <Table heads={['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance']} figures={[3, 4, 5]}>
      {[<tr key="open" className="muted"><td /><td /><td>Opening balance</td><td /><td /><td className="fig"><Figure line={JSON.stringify([a.id, 'opening'])}>{usd(a.opening)}</Figure></td></tr>,
        ...a.rows.map((l: D) => <tr key={l.id}><td>{day(l.entry_date)}</td><td>{l.number ?? '—'}</td><td>{l.entry_memo}{l.reverses_id ? ' (reversal)' : l.reversed_by_id ? ' (reversed)' : ''}<AskAccountant subjectKind="journal" subjectId={l.entry_id} label={`Entry ${l.number ?? ''} · ${l.entry_date} · ${l.entry_memo}`} /></td><td className="fig">{l.debit_cents ? <Figure line={JSON.stringify([a.id, 'debit', l.id])}>{usd(l.debit_cents)}</Figure> : ''}</td><td className="fig">{l.credit_cents ? <Figure line={JSON.stringify([a.id, 'credit', l.id])}>{usd(l.credit_cents)}</Figure> : ''}</td><td className="fig"><Figure line={JSON.stringify([a.id, 'running', l.id])}>{usd(l.running)}</Figure></td></tr>), <tr key="closing" className="total"><td /><td /><td>Closing balance</td><td /><td /><td className="fig"><Figure line={JSON.stringify([a.id, 'closing'])}>{usd(a.closing)}</Figure></td></tr>]}
    </Table></div>) : <p>No activity in this range.</p>}</>
}

/** A statement whose every line and total opens to its records. Sections are [title, rows, total, total's line key]. */
function Statement({ sections, total }: { sections: [string, D[], number, string][]; total?: [string, number, string] }) {
  return <Table heads={['Account', 'Amount']} figures={[1]}>
    {[...sections.flatMap(([title, rows, sum, key]) => [<tr key={title} className="section"><td colSpan={2}>{title}</td></tr>,
      ...rows.map(x => <tr key={title + x.id}><td><Figure line={x.id}>{x.code ? `${x.code} · ` : ''}{x.name}</Figure></td><td className="fig"><Figure line={x.id}>{usd(x.amount)}</Figure></td></tr>),
      <tr key={title + 'total'} className="total"><td><Figure line={key}>Total {title.toLowerCase()}</Figure></td><td className="fig"><Figure line={key}>{usd(sum)}</Figure></td></tr>]),
      ...(total ? [<tr key="grand" className="total grand"><td><Figure line={total[2]}>{total[0]}</Figure></td><td className="fig"><Figure line={total[2]}>{usd(total[1])}</Figure></td></tr>] : [])]}
  </Table>
}

/** Accrual net income to cash net income for the same range. */
function Bridge({ b }: { b: D }) {
  return <div className="bridge"><h3>From accrual to cash net income</h3>
    <Table heads={['', 'Amount']} figures={[1]}>
      <tr><td>Net income on the accrual basis</td><td className="fig"><Figure line="bridge:accrual">{usd(b.accrualNetIncome)}</Figure></td></tr>
      <tr><td>Less invoices, credits and bills recorded in this period</td><td className="fig"><Figure line="bridge:recorded">{usd(-b.recordedInRange)}</Figure></td></tr>
      <tr><td>Plus the shares of them paid or credited in this period</td><td className="fig"><Figure line="bridge:settled">{usd(b.settledInRange)}</Figure></td></tr>
      <tr className="total"><td>Net income on the cash basis {b.ties ? '' : '(does not tie)'}</td><td className="fig"><Figure line="bridge:cash">{usd(b.cashNetIncome)}</Figure></td></tr>
    </Table></div>
}

function Ageing({ r }: { r: D }) {
  return <>
    <p className={r.agrees ? 'tone-good' : 'tone-bad'}>{r.kind === 'receivable' ? 'Receivables' : 'Payables'} <Figure line={JSON.stringify(['subledger'])}>{usd(r.subledger)}</Figure> {r.agrees ? 'agree to' : 'do not agree to'} {r.control ? <>{r.control.name} <Figure line={JSON.stringify(['control'])}>{usd(r.control.balance)}</Figure></> : 'a control account'}{r.unapplied ? <> (after <Figure line={JSON.stringify(['unapplied'])}>{usd(r.unapplied)}</Figure> received or credited but not yet applied)</> : ''}.</p>
    <Table heads={['Who', 'Reference', 'Due', 'Days overdue', 'Bucket', 'Open']} figures={[3, 5]} empty="Nothing open.">
      {[...r.items.map((i: D) => <tr key={i.id}><td>{i.contact}</td><td>{i.ref}<AskAccountant subjectKind={r.kind === 'receivable' ? 'invoice' : 'bill'} subjectId={i.id} label={`${i.ref} · ${i.contact} · ${usd(i.open)} open`} /></td><td>{day(i.due_date)}</td><td className="fig">{Math.max(0, i.overdue)}</td><td>{i.bucket}</td><td className="fig"><Figure line={JSON.stringify(['item', i.id])}>{usd(i.open)}</Figure></td></tr>),
        <tr key="t" className="total"><td>Total</td><td /><td /><td /><td>{r.buckets.map((b: string, k: number) => <span key={b}>{k ? ' · ' : ''}{b} <Figure line={JSON.stringify(['bucket', b])}>{usd(r.totals[k])}</Figure></span>)}</td><td className="fig"><Figure line={JSON.stringify(['items'])}>{usd(r.itemsTotal)}</Figure></td></tr>]}
    </Table>
  </>
}

function BasisSwitch({ basis, onChange }: { basis: Basis; onChange: (b: Basis) => void }) {
  return <div className="basis-switch" role="radiogroup" aria-label="Cash or accrual">
    {(['cash', 'accrual'] as const).map(b => <button key={b} type="button" role="radio" aria-checked={basis === b} className={basis === b ? 'active' : ''} onClick={() => onChange(b)}>{b === 'cash' ? 'Cash' : 'Accrual'}</button>)}
  </div>
}

const DAY = /^(\d{4})-(\d{2})-\d{2}$/
// A date field's text is only used once it is a real YYYY-MM-DD; the package period is rebuilt from numbers.
const isDay = (v: string) => DAY.test(v)
const periodOf = (v: string) => { const m = DAY.exec(v); return `${String(Number(m![1])).padStart(4, '0')}-${String(Number(m![2])).padStart(2, '0')}` }

function Report({ slug, basis, from, to, columns }: { slug: string; basis: Basis; from: string; to: string; columns: ColumnMode }) {
  const search = useSearch({ from: '/app/reports' })
  const ranged = KINDS.find(k => k[1] === slug)![3]
  const { data: r, error } = useView<D>(slug === 'budget-actual' ? null : `reports/${slug}?to=${to}${ranged || columns !== 'single' ? `&from=${from}` : ''}&basis=${basis}${columns !== 'single' ? `&columns=${columns}` : ''}${slug === 'general-ledger' && search.account ? `&account=${encodeURIComponent(search.account)}` : ''}`)
  if (slug === 'budget-actual') return <Budgets from={from} to={to} basis={basis} />
  if (!r) return <Loading error={error} what="the report" />
  if (columns !== 'single') return <StatementColumns report={r as ColumnStatement} />
  if (slug === 'trial-balance') return <Trial r={r} from={from} to={to} basis={basis} />
  if (slug === 'general-ledger') return <Ledger r={r} />
  if (slug === 'profit-and-loss') return <><p className="hint">Choose any line or total to see the records behind it.</p>
    <Statement sections={[['Income', r.income, r.totalIncome, 'income'], ['Expenses', r.expenses, r.totalExpenses, 'expenses']]} total={['Net income', r.netIncome, 'net-income']} />{r.bridge && <Bridge b={r.bridge} />}</>
  if (slug === 'balance-sheet') return <><p>{r.balanced ? <Chip tone="good">Assets equal liabilities plus equity</Chip> : <Chip tone="bad">Out of balance</Chip>}</p>
    {basis === 'cash' && <p className="hint">On the cash basis, unpaid invoices and bills stay off the balance sheet with the tax on them; money received or paid but not yet applied stays in receivables or payables.</p>}
    <Statement sections={[['Assets', r.assets, r.totalAssets, 'assets'], ['Liabilities', r.liabilities, r.totalLiabilities, 'liabilities'], ['Equity', r.equity, r.totalEquity, 'equity']]} total={['Liabilities and equity', r.totalLiabilities + r.totalEquity, 'liabilities-and-equity']} /></>
  if (slug === 'sales-by-customer' || slug === 'expenses-by-vendor') return <Table heads={[slug === 'sales-by-customer' ? 'Customer' : 'Vendor', 'Amount']} figures={[1]} empty="No posted activity in this range.">
    {[...r.rows.map((x: D) => <tr key={x.id}><td>{x.name}</td><td className="fig"><Figure line={x.id}>{usd(x.amount)}</Figure></td></tr>), <tr key="total" className="total"><td>Total</td><td className="fig"><Figure line="total">{usd(r.total)}</Figure></td></tr>]}
  </Table>
  if (slug === 'sales-by-item') return <><p className="hint">Income by the product or service each invoice and credit line was sold as. Income without an item stays in its own row, so the total ties to the profit and loss.</p><Table heads={['Product or service', 'SKU', 'Amount']} figures={[2]} empty="No posted income in this range.">
    {[...r.rows.map((x: D) => <tr key={x.id}><td>{x.name}</td><td>{x.sku ?? ''}</td><td className="fig"><Figure line={x.id}>{usd(x.amount)}</Figure></td></tr>), <tr key="total" className="total"><td>Total</td><td /><td className="fig"><Figure line="total">{usd(r.total)}</Figure></td></tr>]}
  </Table></>
  if (slug === 'cash-flow') return <CashFlow from={from} to={to} />
  if (slug === 'sales-tax') return <SalesTax r={r} />
  return <Ageing r={r} />
}

export function Reports() {
  const search = useSearch({ from: '/app/reports' }), navigate = useNavigate({ from: '/app/reports' }), { state } = useShared()
  const set = (patch: ReportSearch) => navigate({ search: (s: ReportSearch) => ({ ...s, ...patch }), replace: !('report' in patch || 'line' in patch || 'record' in patch) })
  const customOnly = customReportsOnly(state.actor), kinds = customOnly ? KINDS.filter(k => k[1] === 'custom') : KINDS
  const kind = kinds.find(k => k[1] === search.report) ?? kinds[0], [label, slug, based, ranged] = kind
  useEffect(() => {
    if (customOnly && (search.report !== 'custom' || search.line || search.record)) void navigate({ search: (s: ReportSearch) => ({ ...s, report: 'custom', line: undefined, record: undefined }), replace: true })
  }, [customOnly, search.report, search.line, search.record, navigate])
  const statement = slug === 'profit-and-loss' || slug === 'balance-sheet', columns = statement ? columnMode(search.columns, slug) : 'single'
  // The declared tax method picks the basis a report opens on; the switch changes only what is shown.
  const basis: Basis = search.basis === 'cash' || search.basis === 'accrual' ? search.basis : state.settings?.entity?.tax_method === 'cash' ? 'cash' : 'accrual'
  const to = search.to && isDay(search.to) ? search.to : today(), from = search.from && isDay(search.from) ? search.from : to.slice(0, 8) + '01'
  // The package is for a closed month: the one the dates point at once someone chooses them, else the last month locked.
  const period = !search.to && state.overview?.lastLocked ? state.overview.lastLocked : periodOf(to), q = basis === 'cash' ? '?basis=cash' : ''
  const detail = (['profit-and-loss', 'balance-sheet', 'cash-flow', 'trial-balance', 'general-ledger', 'sales-by-customer', 'expenses-by-vendor', 'sales-by-item', 'budget-actual', 'contractors', 'receivables', 'payables', 'sales-tax'].includes(slug) || isLibraryReport(slug) && slug !== 'audit-log') && search.line
  // 1099 figures read a calendar tax year.
  const taxYear = Number(search.year) || Number(today().slice(0, 4)), [figureFrom, figureTo] = slug === 'contractors' ? [`${taxYear}-01-01`, `${taxYear}-12-31`] : [from, to]
  const library = isLibraryReport(slug), filtered = hasLibraryFilters(slug)
  const exportQuery = library ? libraryQuery(slug, from, to, basis, search.account, search.payee) : `from=${from}&to=${to}&basis=${basis}${statement ? `&columns=${columns}` : ''}${slug === 'general-ledger' && search.account ? `&account=${encodeURIComponent(search.account)}` : ''}`
  return <>
    <PageHead title="Reports" lead="Every report is calculated from the same posted ledger, on the cash or the accrual basis."
      actions={!customOnly && <><a className="btn btn-secondary" href={`/api/pantry/package/${period}/general-ledger.csv${q}`} download>General ledger CSV · {basis === 'cash' ? 'cash' : 'accrual'}</a><a className="btn btn-primary" href={`/api/pantry/package/${period}/accountant-package.zip${q}`} download title="A ZIP of CSV reports, the close checklist and a README">Accountant package · {monthName(period)}</a></>} />
    <Tabs tabs={kinds.map(k => k[0])} current={label} onChange={t => set({ report: kinds.find(k => k[0] === t)![1], line: undefined, record: undefined })} pick="Report" />
    {customOnly ? <CustomReports /> : search.record ? <RecordView record={search.record} reportLabel={label} /> : detail && slug === 'cash-flow' ? <CashFlowDetail line={search.line!} from={from} to={to} />
      : detail ? <FigureDetail report={slug} line={search.line!} from={figureFrom} to={figureTo} basis={basis} reportLabel={label} />
      : slug === 'custom' ? <CustomReports /> : slug === 'contractors' ? <Contractors year={taxYear} onYear={y => set({ year: String(y) })} />
      : <Card className={library ? 'report-library' : undefined} title={<>{label} <Chip tone="info">{library ? libraryBasisLabel(slug, basis) : slug === 'cash-flow' ? 'Indirect method · accrual starting income' : based ? BASIS_NAME[basis] : 'Open items · accrual basis'}</Chip></>} actions={<div className="inline-fields">{based && <BasisSwitch basis={basis} onChange={b => set({ basis: b })} />}
          {statement && <ColumnPicker mode={columns} kind={slug} onChange={mode => set({ columns: mode, line: undefined, record: undefined, column: undefined })} />}
          {ranged && <div className="field inline"><label htmlFor="r-from">From</label><input id="r-from" type="date" value={from} onChange={e => isDay(e.target.value) && set({ from: e.target.value })} /></div>}
          <div className="field inline"><label htmlFor="r-to">{ranged ? 'To' : 'As of'}</label><input id="r-to" type="date" value={to} onChange={e => isDay(e.target.value) && set({ to: e.target.value })} /></div>
          {filtered && <><Field label="Account filter" name="account" value={search.account ?? ''} empty="All accounts" options={state.accounts.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set({ account: e.target.value || undefined })} />
            <Field label="Payee filter" name="payee" value={search.payee ?? ''} empty="All payees" options={state.contacts.map((c: D) => ({ value: c.id, label: c.name }))} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => set({ payee: e.target.value || undefined })} /></>}
          </div>}>
          {(library || based && slug !== 'budget-actual') && <p className="row-actions"><a className="btn btn-secondary" href={`/api/pantry/reports/${slug}/export?${exportQuery}&format=pdf`} download>Download PDF{based ? ` · ${basis}` : ''}</a><a className="btn btn-secondary" href={`/api/pantry/reports/${slug}/export?${exportQuery}&format=csv`} download>Download CSV{based ? ` · ${basis}` : ''}</a><a className="btn btn-secondary" href={`/api/pantry/reports/${slug}/export?${exportQuery}&format=xlsx`} download>Download Excel{based ? ` · ${basis}` : ''}</a></p>}
          {library ? <ReportLibrary slug={slug} basis={basis} from={from} to={to} /> : <Report slug={slug} basis={basis} from={from} to={to} columns={columns} />}
        </Card>}
  </>
}
