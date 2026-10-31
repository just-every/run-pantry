// Overview: the business and its figures in one quiet line, then everything waiting for a
// person as one list whose first item is done right here. Setup steps follow while setup is open.
import { Link } from '@tanstack/react-router'
import { Card, Chip, Loading, today, useShared, useView, type D } from './kit'
import { Figures, Overdue } from './home-figures'
import { NeedsAttention } from './attention'

const GO: Record<string, string> = { settings: '/app/settings/business', books: '/app/books', 'move-in': '/app/move-in', sales: '/app/sales', contacts: '/app/sales', bank: '/app/bank', close: '/app/close' }

function SetupSteps({ steps }: { steps: D[] }) {
  const done = steps.filter(s => s.done).length
  // One navy action on the page: the next step to do. Every other step is a white secondary.
  const next = steps.find(s => !s.done)?.key
  return <Card title="Setup steps" actions={<span className="progress-count">{done} of {steps.length} complete</span>}>
    <span className="progress-bar" aria-hidden="true"><span style={{ width: `${(done / steps.length) * 100}%` }} /></span>
    <ol className="steps">{steps.map((s, i) => <li key={s.key} className={`step${s.done ? ' done' : ''}`}>
      <span className="step-no">{i + 1}</span>
      <div className="step-text"><strong>{s.title}</strong><span>{s.detail}{s.key === 'chart' && !s.done && <>. Post opening balances as one journal entry. <a href="/app/books?tab=journal">Open journal entries</a>.</>}</span></div>
      {s.done ? <Chip tone="good">Complete</Chip> : <Chip tone="warn">To do</Chip>}
      <Link className={`btn ${s.key === next ? 'btn-primary' : 'btn-secondary'}`} to={GO[s.go]} search={(s.go === 'contacts' ? { tab: 'contacts' } : undefined) as any}>{s.done ? 'View' : 'Start'}</Link>
    </li>)}</ol>
  </Card>
}

export function Overview() {
  const { state, reload } = useShared(), { steps, entity } = state.overview
  const { data, error, reload: again } = useView<D>(`home?to=${today()}`)
  const refresh = async () => { await again(); await reload() }
  return <>
    <div className="home-head"><h1>{entity ? entity.legal_name : 'Get started with Pantry'}</h1>{data && <Figures f={data.figures} />}</div>
    {data ? <><NeedsAttention home={data} onDone={refresh} /><Overdue overdue={data.overdue} asOf={data.asOf} /></> : <Loading error={error} what="what needs attention" />}
    {steps.some((s: D) => !s.done) && <SetupSteps steps={steps} />}
  </>
}
