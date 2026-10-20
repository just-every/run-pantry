import { StripeClearing } from './stripe-clearing'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Card, day, Field, Loading, Table, today, usd, useView, type D } from './kit'

export function DashboardSummary() {
  const [asOf, setAsOf] = useState(today()), [basis, setBasis] = useState('')
  const { data: d, error } = useView<D>(`dashboard?to=${asOf}${basis ? `&basis=${basis}` : ''}`)
  if (!d) return <Loading error={error} what="dashboard figures" />
  return <>
    <StripeClearing value={d.clearing} />
    <Card title="Books up to date through" actions={<Field label="As of" name="dashboard-date" type="date" value={asOf} onChange={(e: any) => e.target.value && setAsOf(e.target.value)} />}>
      <p><strong>{d.currentThrough ? day(d.currentThrough) : 'No locked or fully reconciled date yet'}</strong>{d.currentThrough && <> · {d.currentSource === 'locked' ? 'month locked' : 'all bank and card accounts reconciled'}</>}</p>
      <Link to="/app/close" search={d.currentThrough ? { period: d.currentThrough.slice(0, 7) } : undefined}>Open close</Link>
    </Card>
    <div className="split split-wide-left">
      <Card title="Cash across accounts">
        <p><strong>{d.cash.observed ? usd(d.cash.total) : 'No feed cash balance yet'}</strong> · {d.cash.observed} of {d.cash.expected} cash accounts reporting</p>
        <p className="hint">Bank-reported balances at each account's last sync. Credit-card debt is shown separately and is not included in cash.</p>
        <Table heads={['Account', 'Bank balance', 'Last sync']} figures={[1]} empty="No bank accounts yet.">{d.cash.accounts.map((a: D) => <tr key={a.id}><td><Link to="/app/bank">{a.name}</Link>{a.type === 'liability' && <small className="sub">Card or credit line · owed</small>}</td><td className="fig">{a.balance_cents === null ? 'No feed balance' : usd(a.balance_cents)}</td><td>{a.balance_cents === null ? '—' : day(a.last_synced_at)}</td></tr>)}</Table>
      </Card>
      <Card title="This month's bank movements">
        <p>{day(d.from)} to {day(d.asOf)} · Bank and statement lines, including transfers; card charges are separate.</p>
        <p>Money in <strong>{usd(d.movements.moneyIn)}</strong></p><p>Money out <strong>{usd(d.movements.moneyOut)}</strong></p>
        <Link to="/app/bank">Open transactions</Link>
      </Card>
    </div>
    <div className="split split-wide-left">
      <Card title="Profit and loss trend" actions={<Field label="Dashboard basis" name="dashboard-basis" value={basis || d.basis} onChange={(e: any) => setBasis(e.target.value)} options={[{ value: 'cash', label: 'Cash basis' }, { value: 'accrual', label: 'Accrual basis' }]} />}>
        <p className="hint">{d.basis === 'cash' ? 'Cash basis' : 'Accrual basis'} · This month runs through {day(d.asOf)}.</p>
        <Table heads={['Month', 'Income', 'Expenses', 'Net income']} figures={[1, 2, 3]}>{d.trend.map((m: D) => <tr key={m.month}><td><Link to="/app/reports" search={{ report: 'profit-and-loss', from: m.from, to: m.to, basis: d.basis }}>{m.month}</Link></td><td className="fig">{usd(m.income)}</td><td className="fig">{usd(m.expenses)}</td><td className="fig">{usd(m.netIncome)}</td></tr>)}</Table>
      </Card>
      <Card title="Balances and evidence waiting">
        <Table heads={['Overdue balance', 'Amount', 'Items']} figures={[1, 2]}>
          <tr><td><Link to="/app/reports" search={{ report: 'receivables', to: d.asOf }}>Overdue receivables</Link></td><td className="fig">{usd(d.overdue.receivables.amount)}</td><td className="fig">{d.overdue.receivables.count}</td></tr>
          <tr><td><Link to="/app/reports" search={{ report: 'payables', to: d.asOf }}>Overdue payables</Link></td><td className="fig">{usd(d.overdue.payables.amount)}</td><td className="fig">{d.overdue.payables.count}</td></tr>
        </Table>
        <ul className="queue">
          <li><Link to="/app/sales" search={{ tab: 'bills' }}><strong>{d.work.billsToApprove}</strong><span>Bills to approve</span></Link></li>
          <li><Link to="/app/bank"><strong>{d.work.brokenConnections}</strong><span>Connections needing attention</span></Link></li>
        </ul>
        <p>Missing receipts and bill documents: <strong>{d.work.missingReceipts}</strong></p>
        <ul>{d.work.missingByMonth.map((m: D) => <li key={m.month}><Link to="/app/close" search={{ period: m.month }}>{m.month} · {m.count} missing source document{m.count === 1 ? '' : 's'}</Link></li>)}</ul>
      </Card>
    </div>
  </>
}
