// The Overview's quiet figures (each opens the page behind it) and the overdue balances at its foot.
import { Link } from '@tanstack/react-router'
import { day, usd, type D } from './kit'
import { Icon } from './icons'

const THROUGH: Record<string, string> = { locked: 'Books locked through', 'fully-reconciled': 'Books reconciled through' }

export function Figures({ f }: { f: D }) {
  return <dl className="figures">
    <div><dt>Cash</dt><dd><Link to="/app/bank">{f.cash.observed ? usd(f.cash.total) : 'No feed balance yet'}</Link>{f.cash.observed < f.cash.expected && <small>{f.cash.observed} of {f.cash.expected} accounts reporting</small>}</dd></div>
    <div className="figure-month"><dt>Money in this month</dt><dd><Link to="/app/bank">{usd(f.moneyIn)}</Link></dd></div>
    <div className="figure-month"><dt>Money out</dt><dd><Link to="/app/bank">{usd(f.moneyOut)}</Link></dd></div>
    <div><dt>{THROUGH[f.currentSource] ?? 'Books up to date through'}</dt><dd><Link to="/app/close" search={(f.currentThrough ? { period: f.currentThrough.slice(0, 7) } : undefined) as any}>{f.currentThrough ? day(f.currentThrough) : 'Not yet'}</Link></dd></div>
  </dl>
}

export function Overdue({ overdue, asOf }: { overdue: D; asOf: string }) {
  const due = [
    { key: 'receivables', label: 'Overdue receivables', icon: 'clock', n: overdue.receivables, what: (n: number) => `${n} invoice${n === 1 ? '' : 's'}` },
    { key: 'payables', label: 'Overdue payables', icon: 'alert', n: overdue.payables, what: (n: number) => `${n} bill${n === 1 ? '' : 's'}` },
  ].filter(d => d.n.count > 0)
  return due.length > 0 && <div className="overdue">{due.map(d => <Link key={d.key} to="/app/reports" search={{ report: d.key, to: asOf } as any}>
    <Icon name={d.icon} /><span><span>{d.label}</span><strong>{usd(d.n.amount)} · {d.what(d.n.count)}</strong></span>
  </Link>)}</div>
}
