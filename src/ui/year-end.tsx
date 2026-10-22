import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Action, Card, Chip, Loading, Table, command, day, monthName, usd, useShared, useView, type D } from './kit'

function YearEndPanel({ year }: { year: number }) {
  const { data: s, error, reload } = useView<D>(`year-end/${year}`), shared = useShared()
  const [selectedBasis, setBasis] = useState<string | null>(null), basis = selectedBasis ?? (shared.state.settings?.entity?.tax_method === 'cash' ? 'cash' : 'accrual')
  if (!s) return <Loading error={error} what="year-end" />
  const earnings = (bs: D, id: string) => bs.equity.find((e: D) => e.id === id)?.amount ?? 0
  return <div className="stack">
    <p>{day(s.start)} to {day(s.end)} · Accrual books. Earnings roll by calculation; no closing journal is posted.</p>
    <Table heads={['At fiscal year end', 'First day of the next year']}>
      <tr><td>Current earnings {usd(earnings(s.closingBalanceSheet, 'current-earnings'))}<br />Prior earnings {usd(earnings(s.closingBalanceSheet, 'prior-earnings'))}</td><td>Current earnings {usd(earnings(s.openingBalanceSheet, 'current-earnings'))}<br />Prior earnings {usd(earnings(s.openingBalanceSheet, 'prior-earnings'))}</td></tr>
    </Table>
    <h3>Year-end readiness</h3>
    <Table heads={['Check', 'Status', 'Details']}>
      {s.checks.map((c: D) => <tr key={c.key}><td>{c.title}</td><td><Chip tone={c.ok ? 'good' : 'warn'}>{c.ok ? 'Ready for review' : 'Resolve'}</Chip></td><td>{c.detail}</td></tr>)}
    </Table>
    <p>Recorded payroll totals: gross {usd(s.payrollTotals.gross)} · employer taxes {usd(s.payrollTotals.employerTax)} · withheld {usd(s.payrollTotals.withheld)} · net pay {usd(s.payrollTotals.net)} · bank debits {usd(s.payrollTotals.debit)}.</p>
    <p><Link to="/app/reports" search={{report:'adjusting-entries',from:s.start,to:s.end,basis}}>Filter and split adjusting entries by dimension</Link></p>
    <h3>Adjusting entries <Chip tone="info">{basis === 'cash' ? 'Cash basis' : 'Accrual basis'}</Chip></h3>
    <div className="field inline"><label htmlFor="adjusting-basis">Adjusting report basis</label><select id="adjusting-basis" value={basis} onChange={e => setBasis(e.target.value)}><option value="cash">Cash</option><option value="accrual">Accrual</option></select></div>
    <p className="hint">Manual adjusting journals have the same lines on both bases. The earnings roll above uses the accrual books.</p>
    <a className="btn btn-secondary" href={`/api/pantry/year-end/${year}/adjusting-entries.pdf?basis=${basis}`} download>Download adjusting entries PDF</a>
    <Table heads={['Entry', 'Prepared by', 'Posted by', 'Debits', 'Credits']} figures={[3, 4]} empty="No posted adjusting entries. Flag a draft in Books and date it at fiscal year end.">
      {s.adjusting.entries.map((e: D) => <tr key={e.id}><td><Link to="/app/reports" search={{ report: 'profit-and-loss', from: s.start, to: s.end, basis: 'accrual', record: `entry:${e.id}` }}>Entry {e.number} · {e.memo}</Link></td><td>{e.prepared_by}</td><td>{e.posted_by}</td><td className="fig">{usd(e.lines.reduce((n: number, l: D) => n + l.debit_cents, 0))}</td><td className="fig">{usd(e.lines.reduce((n: number, l: D) => n + l.credit_cents, 0))}</td></tr>)}
    </Table>
    <h3>Monthly closes</h3>
    <Table heads={['Month', 'Status', 'What is left']}>
      {s.months.map((m: D) => <tr key={m.id}><td><a href={`/app/close?period=${m.id}`}>{monthName(m.id)}</a></td><td><Chip tone={m.status === 'locked' ? 'good' : m.ready ? 'info' : 'warn'}>{m.status === 'locked' ? 'Locked' : m.ready ? 'Ready' : 'Open'}</Chip></td><td>{m.checks.map((c: D) => c.title).join('; ')}{!m.hasTasks ? ' Add review tasks.' : m.tasksOpen ? ` ${m.tasksOpen} review tasks open.` : ''}</td></tr>)}
    </Table>
    {s.locked ? <p role="status"><strong>Fiscal year {year} locked.</strong> Reopening uses each month’s existing request and approval.</p>
      : <><p>Complete every month’s checks and review tasks, including the final month’s 1099 and payroll reviews. This locks all twelve months together under the existing lock grant.</p>
        <Action tone="primary" disabled={!s.ready || !shared.state.actor.can.lock} run={async () => { await command('year-end.lock', { year, revision: s.revision }); await reload(); await shared.reload() }}>Lock fiscal year {year}</Action></>}
  </div>
}

export function YearEnd({ period }: { period: string }) {
  const shared = useShared(), [open, setOpen] = useState(false)
  const startMonth = Number(shared.state.settings?.entity?.fiscal_year_start ?? 1)
  const initialYear = Number(period.slice(0, 4)) + (startMonth > 1 && Number(period.slice(5)) >= startMonth ? 1 : 0)
  const [chosen, setChosen] = useState<number | null>(null), year = chosen ?? initialYear
  return <Card title="Fiscal year-end">
    <details onToggle={e => setOpen(e.currentTarget.open)}><summary>Review and lock a fiscal year</summary>
      <div className="field inline"><label htmlFor="fiscal-end-year">Fiscal year ending in</label><input id="fiscal-end-year" type="number" min="2000" max="9998" value={year} onChange={e => { const value = Number(e.target.value); if (value >= 2000 && value <= 9998) setChosen(value) }} /></div>
      {open && <YearEndPanel key={year} year={year} />}
    </details>
  </Card>
}
