// Reports, all from the same ledger, and the accountant package download.
import { useState } from 'react'
import { Card, Chip, Loading, PageHead, Table, Tabs, day, today, usd, useView, type D } from './kit'

const KINDS: [string, string][] = [['Trial balance', 'trial-balance'], ['General ledger', 'general-ledger'], ['Profit and loss', 'profit-and-loss'], ['Balance sheet', 'balance-sheet'], ['Receivables aging', 'receivables'], ['Payables aging', 'payables']]

function Trial({ r }: { r: D }) {
  return <Table heads={['Code', 'Account', 'Debit', 'Credit']} figures={[2, 3]} empty="No posted balances on this date.">
    {[...r.rows.map((x: D) => <tr key={x.id}><td>{x.code}</td><td>{x.name}</td><td className="fig">{x.debitBalance ? usd(x.debitBalance) : ''}</td><td className="fig">{x.creditBalance ? usd(x.creditBalance) : ''}</td></tr>),
      <tr key="total" className="total"><td /><td>Total {r.balanced ? '' : '(out of balance)'}</td><td className="fig">{usd(r.debit)}</td><td className="fig">{usd(r.credit)}</td></tr>]}
  </Table>
}

function Ledger({ r }: { r: D }) {
  return <>{r.accounts.length ? r.accounts.map((a: D) => <div key={a.id} className="gl-account"><h3>{a.code} · {a.name}</h3>
    <Table heads={['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance']} figures={[3, 4, 5]}>
      {[<tr key="open" className="muted"><td /><td /><td>Opening balance</td><td /><td /><td className="fig">{usd(a.opening)}</td></tr>,
        ...a.rows.map((l: D) => <tr key={l.id}><td>{day(l.entry_date)}</td><td>{l.number}</td><td>{l.entry_memo}{l.reverses_id ? ' (reversal)' : l.reversed_by_id ? ' (reversed)' : ''}</td><td className="fig">{l.debit_cents ? usd(l.debit_cents) : ''}</td><td className="fig">{l.credit_cents ? usd(l.credit_cents) : ''}</td><td className="fig">{usd(l.running)}</td></tr>)]}
    </Table></div>) : <p>No activity in this range.</p>}</>
}

function Statement({ sections, total }: { sections: [string, D[], number][]; total?: [string, number] }) {
  return <Table heads={['Account', 'Amount']} figures={[1]}>
    {[...sections.flatMap(([title, rows, sum]) => [<tr key={title} className="section"><td colSpan={2}>{title}</td></tr>, ...rows.map(x => <tr key={title + x.id}><td>{x.code ? `${x.code} · ` : ''}{x.name}</td><td className="fig">{usd(x.amount)}</td></tr>), <tr key={title + 'total'} className="total"><td>Total {title.toLowerCase()}</td><td className="fig">{usd(sum)}</td></tr>]),
      ...(total ? [<tr key="grand" className="total grand"><td>{total[0]}</td><td className="fig">{usd(total[1])}</td></tr>] : [])]}
  </Table>
}

function Ageing({ r }: { r: D }) {
  return <>
    <p className={r.agrees ? 'tone-good' : 'tone-bad'}>{r.kind === 'receivable' ? 'Receivables' : 'Payables'} {usd(r.subledger)} {r.agrees ? 'agree to' : 'do not agree to'} {r.control ? `${r.control.name} ${usd(r.control.balance)}` : 'a control account'}{r.unapplied ? ` (after ${usd(r.unapplied)} received or credited but not yet applied)` : ''}.</p>
    <Table heads={['Who', 'Reference', 'Due', 'Days overdue', 'Bucket', 'Open']} figures={[3, 5]} empty="Nothing open.">
      {[...r.items.map((i: D) => <tr key={i.id}><td>{i.contact}</td><td>{i.ref}</td><td>{day(i.due_date)}</td><td className="fig">{Math.max(0, i.overdue)}</td><td>{i.bucket}</td><td className="fig">{usd(i.open)}</td></tr>),
        <tr key="t" className="total"><td>Total</td><td /><td /><td /><td>{r.buckets.map((b: string, k: number) => `${b} ${usd(r.totals[k])}`).join(' · ')}</td><td className="fig">{usd(r.itemsTotal)}</td></tr>]}
    </Table>
  </>
}

const DAY = /^(\d{4})-(\d{2})-\d{2}$/
// A date field's text is only used once it is a real YYYY-MM-DD; the package period is rebuilt from numbers.
const isDay = (v: string) => DAY.test(v)
const periodOf = (v: string) => { const m = DAY.exec(v); return `${String(Number(m![1])).padStart(4, '0')}-${String(Number(m![2])).padStart(2, '0')}` }

export function Reports() {
  const [kind, setKind] = useState('Trial balance'), [to, setTo] = useState(today()), [from, setFrom] = useState(today().slice(0, 8) + '01')
  const slug = KINDS.find(k => k[0] === kind)![1], ranged = slug === 'general-ledger' || slug === 'profit-and-loss'
  const { data: r, error } = useView<D>(`reports/${slug}?to=${to}${ranged ? `&from=${from}` : ''}`)
  const period = periodOf(to)
  return <>
    <PageHead title="Reports" lead="Every report is calculated from the same posted ledger."
      actions={<><a className="btn btn-secondary" href={`/api/pantry/package/${period}/general-ledger.csv`} download>General ledger CSV</a><a className="btn btn-primary" href={`/api/pantry/package/${period}`} download>Download accountant package</a></>} />
    <Tabs tabs={KINDS.map(k => k[0])} current={kind} onChange={setKind} pick="Report" />
    <Card title={kind} actions={<div className="inline-fields">{ranged && <div className="field inline"><label htmlFor="r-from">From</label><input id="r-from" type="date" value={from} onChange={e => isDay(e.target.value) && setFrom(e.target.value)} /></div>}<div className="field inline"><label htmlFor="r-to">{ranged ? 'To' : 'As of'}</label><input id="r-to" type="date" value={to} onChange={e => isDay(e.target.value) && setTo(e.target.value)} /></div></div>}>
      {!r ? <Loading error={error} what="the report" />
        : slug === 'trial-balance' ? <Trial r={r} />
        : slug === 'general-ledger' ? <Ledger r={r} />
        : slug === 'profit-and-loss' ? <Statement sections={[['Income', r.income, r.totalIncome], ['Expenses', r.expenses, r.totalExpenses]]} total={['Net income', r.netIncome]} />
        : slug === 'balance-sheet' ? <><p>{r.balanced ? <Chip tone="good">Assets equal liabilities plus equity</Chip> : <Chip tone="bad">Out of balance</Chip>}</p><Statement sections={[['Assets', r.assets, r.totalAssets], ['Liabilities', r.liabilities, r.totalLiabilities], ['Equity', r.equity, r.totalEquity]]} total={['Liabilities and equity', r.totalLiabilities + r.totalEquity]} /></>
        : <Ageing r={r} />}
    </Card>
  </>
}
