// Shared approval controls for agent work, bank matches and Pantry's answers.
// Every approval carries the exact date and the server's freshly calculated
// effects token. A changed date immediately withdraws the previous approval.
import { useEffect, useState, type ReactNode } from 'react'
import { Action, command, day, Field, Table, usd, type D } from './kit'

type Pair = { label: string; before: number; after: number }
const pair = (label: string, before: number, after: number): Pair => ({ label, before: before ?? 0, after: after ?? 0 })
function rows(before: D[], after: D[], field = 'amount'): Pair[] {
  const key = (r: D) => r.id ?? r.state ?? r.name
  const b = new Map(before.map(r => [key(r), r])), a = new Map(after.map(r => [key(r), r]))
  return [...new Set([...b.keys(), ...a.keys()])].map(id => { const r = a.get(id) ?? b.get(id)!; return pair(`${r.code ? r.code + ' · ' : ''}${r.name ?? r.state}`, b.get(id)?.[field], a.get(id)?.[field]) })
}
function Figures({ values, caption }: { values: Pair[]; caption: string }) {
  return <Table heads={['Figure', 'Before', 'After', 'Change']} figures={[1, 2, 3]} caption={caption}>
    {values.map((r, i) => <tr key={i}><td>{r.label}</td><td className="fig">{usd(r.before)}</td><td className="fig"><strong>{usd(r.after)}</strong></td><td className="fig">{r.after === r.before ? '—' : usd(r.after - r.before)}</td></tr>)}
  </Table>
}

export function ProposalEffects({ effects, onReopen }: { effects: D; onReopen: () => void }) {
  const [basis, setBasis] = useState('accrual')
  const { before: b, after: a } = effects.bases[basis]
  const taxLiability = (r: D) => r.salesTax.ledger.accounts.reduce((n: number, row: D) => n + row.closing, 0)
  const sections: { title: string; values: Pair[] }[] = [
    { title: 'Trial balance', values: [...rows(b.trialBalance.rows, a.trialBalance.rows, 'net'), pair('Total debits', b.trialBalance.debit, a.trialBalance.debit), pair('Total credits', b.trialBalance.credit, a.trialBalance.credit)] },
    { title: 'Profit and loss', values: [...rows(b.profitAndLoss.income, a.profitAndLoss.income), ...rows(b.profitAndLoss.expenses, a.profitAndLoss.expenses), pair('Net income', b.profitAndLoss.netIncome, a.profitAndLoss.netIncome)] },
    { title: 'Balance sheet', values: [...rows(b.balanceSheet.assets, a.balanceSheet.assets), ...rows(b.balanceSheet.liabilities, a.balanceSheet.liabilities), ...rows(b.balanceSheet.equity, a.balanceSheet.equity), pair('Total assets', b.balanceSheet.totalAssets, a.balanceSheet.totalAssets), pair('Total liabilities', b.balanceSheet.totalLiabilities, a.balanceSheet.totalLiabilities), pair('Total equity', b.balanceSheet.totalEquity, a.balanceSheet.totalEquity)] },
    { title: 'Cash flow (indirect, accrual)', values: [...rows(b.cashFlow.operating, a.cashFlow.operating), ...rows(b.cashFlow.investing, a.cashFlow.investing), ...rows(b.cashFlow.financing, a.cashFlow.financing), pair('Operating cash', b.cashFlow.totalOperating, a.cashFlow.totalOperating), pair('Investing cash', b.cashFlow.totalInvesting, a.cashFlow.totalInvesting), pair('Financing cash', b.cashFlow.totalFinancing, a.cashFlow.totalFinancing), pair('Net cash change', b.cashFlow.netChange, a.cashFlow.netChange)] },
    { title: 'Sales tax liability', values: [...rows(b.salesTax.ledger.accounts, a.salesTax.ledger.accounts, 'closing'), ...rows(b.salesTax.states, a.salesTax.states, 'owed'), pair('Total liability', taxLiability(b), taxLiability(a)), pair('Tax owed on sales', b.salesTax.totals.owed, a.salesTax.totals.owed)] },
    { title: `${a.contractors.year} 1099 totals`, values: [...rows(b.contractors.vendors, a.contractors.vendors, 'box1'), pair('1099 contractor total', b.contractors.total, a.contractors.total), ...rows(b.contractors.vendors.map((r: D) => ({ ...r, name: `${r.name} · payment method unrecorded` })), a.contractors.vendors.map((r: D) => ({ ...r, name: `${r.name} · payment method unrecorded` })), 'unrecorded')] },
    { title: `Next opening balances · ${a.nextOpening.date}`, values: rows(b.nextOpening.rows, a.nextOpening.rows, 'net') },
  ]
  return <section aria-label="Effects before approval" className="change">
    <p><strong>Net income before {usd(b.profitAndLoss.netIncome)} → after {usd(a.profitAndLoss.netIncome)}</strong><br /><span className="hint">{effects.period} · correction dated {effects.date}. Original records stay. This approval applies to the date and effects shown.</span></p>
    <Field label="Preview basis" name="effects-basis" value={basis} onChange={(e: any) => setBasis(e.target.value)} options={[{ value: 'accrual', label: 'Accrual' }, { value: 'cash', label: 'Cash' }]} />
    <Figures caption="Report totals before and after" values={[
      pair('Net income', b.profitAndLoss.netIncome, a.profitAndLoss.netIncome), pair('Balance sheet · assets', b.balanceSheet.totalAssets, a.balanceSheet.totalAssets), pair('Balance sheet · liabilities', b.balanceSheet.totalLiabilities, a.balanceSheet.totalLiabilities), pair('Balance sheet · equity', b.balanceSheet.totalEquity, a.balanceSheet.totalEquity), pair('Net cash change', b.cashFlow.netChange, a.cashFlow.netChange), pair('Sales tax liability', taxLiability(b), taxLiability(a)), pair('1099 contractor total', b.contractors.total, a.contractors.total),
    ]} />
    <div className="stack">{effects.locks.length ? effects.locks.map((lock: D) => <div key={lock.id} className="callout">
      <div><strong>{lock.name} is locked</strong><p>This correction affects its books. Reopening is required before approval.</p>
        {lock.reopenRequest ? <p>A reopening request is waiting. <a href={`/app/close?month=${lock.id}`}>Review the period</a></p> : <Action run={async () => { await command('period.request-reopen', { period: lock.id, reason: `Review correction proposed for ${effects.date}; its effects have been previewed.` }); onReopen() }}>Request reopening of {lock.name}</Action>}
      </div>
    </div>) : <p className="hint">No locked period changes at this correction date.</p>}</div>
    <p><strong>Issued reports and packages affected</strong></p>
    {effects.issued.length ? <ul>{effects.issued.map((issued: D) => <li key={issued.id}><strong>{issued.name}</strong> · {issued.from} to {issued.to} · {issued.basis} · issued {issued.at.slice(0, 10)}</li>)}</ul> : <p className="hint">No issued report or package changes.</p>}
    {sections.map(section => <details key={section.title} className="details" open={section.title === 'Balance sheet'}><summary>{section.title}</summary><Figures values={section.values} caption={`${section.title} before and after`} /></details>)}
  </section>
}

export function ProposalApproval({ p, onDone, canApprove = true, approveLabel }: { p: D; onDone: () => Promise<void>; canApprove?: boolean; approveLabel?: string }) {
  const financial = p.kind === 'journal' || p.kind === 'match'
  const [date, setDate] = useState(''), [effects, setEffects] = useState<D | null>(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!financial) return
    let cancelled = false; setEffects(null); setError('')
    command('proposal.preview', { id: p.id, revision: p.revision, ...(date ? { date } : {}) }).then(result => { if (!cancelled) setEffects(result.effects) }).catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [p.id, p.revision, date, refresh, financial])
  return <>
    {financial && <><Field label="Correction date" name={`correction-date-${p.id}`} type="date" value={date || effects?.date || ''} onChange={(e: any) => { setEffects(null); setDate(e.target.value) }} />
      {effects ? <ProposalEffects effects={effects} onReopen={() => setRefresh(r => r + 1)} /> : <p role={error ? 'alert' : 'status'} className={error ? 'error' : 'hint'}>{error || 'Calculating report effects…'}</p>}
      <Action run={async () => { setRefresh(r => r + 1) }}>Refresh effects</Action>
    </>}
    {canApprove && <div className="row-actions"><Action tone="primary" disabled={financial && (!effects || !!effects.locks.length)} run={async () => {
      try { await command('proposal.decide', { id: p.id, revision: p.revision, decision: 'approve', ...(financial ? { date: effects!.date, previewToken: effects!.token } : {}) }); await onDone() }
      catch (err) { setEffects(null); setError((err as Error).message); throw err }
    }}>{approveLabel || (p.kind === 'journal' ? 'Approve and post' : 'Approve')}</Action>
      <Action run={async () => { await command('proposal.decide', { id: p.id, revision: p.revision, decision: 'reject' }); await onDone() }}>Reject</Action></div>}
  </>
}

export function QuestionApproval({ q, answer, label, onDone, folded }: { q: D; answer: D; label: string; onDone: () => Promise<void>; folded?: { lead: ReactNode; also: ReactNode } }) {
  const [date, setDate] = useState(q.pending?.date || ''), [effects, setEffects] = useState<D | null>(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
  const identity = JSON.stringify(answer)
  useEffect(() => {
    let cancelled = false; setEffects(null); setError('')
    command('question.preview', { id: q.id, ...JSON.parse(identity), ...(date ? { date } : {}) }).then(result => { if (!cancelled) setEffects(result.effects) }).catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [q.id, q.revision, identity, date, refresh])
  const dateField = <Field label="Correction date" name={`correction-date-${q.id}`} type="date" value={date || effects?.date || ''} onChange={(e: any) => { setEffects(null); setDate(e.target.value) }} />
  const status = <p role={error ? 'alert' : 'status'} className={error ? 'error' : 'hint'}>{error || 'Calculating report effects…'}</p>
  const approve = <Action tone="primary" disabled={!effects || !!effects.locks.length} run={async () => {
    try { await command('question.answer', { id: q.id, ...answer, date: effects!.date, previewToken: effects!.token }); await onDone() }
    catch (err) { setEffects(null); setError((err as Error).message); throw err }
  }}>{label}</Action>, again = <Action run={async () => { setRefresh(r => r + 1) }}>Refresh effects</Action>
  // Folded (the Overview's first item): the answer, its net income change and date, then the
  // decision; every report effect waits under its disclosure, opened by itself when a lock blocks the yes.
  if (folded) return <div className="answer-inline">
    <div className="answer-text">{folded.lead}{effects ? <p className="hint">Net income {usd(effects.netIncome.before)} → {usd(effects.netIncome.after)} · correction dated {day(effects.date)}</p> : status}</div>
    <div className="row-actions">{approve}{folded.also}</div>
    <details className="details" open={!!effects?.locks.length}><summary>Report effects</summary>{dateField}{effects && <ProposalEffects effects={effects} onReopen={() => setRefresh(r => r + 1)} />}{again}</details>
  </div>
  return <>
    {dateField}
    {effects ? <ProposalEffects effects={effects} onReopen={() => setRefresh(r => r + 1)} /> : status}
    <div className="row-actions small">{approve}{again}</div>
  </>
}
