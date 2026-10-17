// Overview: the first-run checklist from completion evidence, and today's queue.
import { Link } from '@tanstack/react-router'
import { Card, Chip, PageHead, useShared, type D } from './kit'

const GO: Record<string, string> = { settings: '/app/settings', books: '/app/books', 'move-in': '/app/move-in', sales: '/app/sales', bank: '/app/bank', close: '/app/close' }

export function Overview() {
  const { state } = useShared(), { steps, queue, entity } = state.overview
  const done = steps.filter((s: D) => s.done).length
  const work = [
    { n: queue.journalDrafts + queue.invoiceDrafts, label: 'Drafts to review or post', to: '/app/books' },
    { n: queue.unmatchedLines, label: 'Unmatched statement lines', to: '/app/bank' },
    { n: queue.receipts, label: 'Receipts to review', to: '/app/receipts' },
    { n: queue.proposals, label: 'Agent proposals waiting', to: '/app/agents' },
    { n: queue.reopenRequests, label: 'Reopening requests', to: '/app/close' },
  ]
  return <>
    <PageHead title={entity ? entity.legal_name : 'Get started with Pantry'} lead={done === steps.length ? 'Your books are set up. Here is what needs attention.' : 'Set up your books, move in your data, and complete your first close.'} />
    <div className="split split-wide-left">
      <Card title="Setup steps" actions={<span className="progress-count">{done} of {steps.length} complete</span>}>
        <span className="progress-bar" aria-hidden="true"><span style={{ width: `${(done / steps.length) * 100}%` }} /></span>
        <ol className="steps">{steps.map((s: D, i: number) => <li key={s.key} className={`step${s.done ? ' done' : ''}`}>
          <span className="step-no">{i + 1}</span>
          <div className="step-text"><strong>{s.title}</strong><span>{s.detail}</span></div>
          {s.done ? <Chip tone="good">Complete</Chip> : <Chip tone="warn">To do</Chip>}
          <Link className={`btn ${s.done ? 'btn-secondary' : 'btn-primary'}`} to={GO[s.go]}>{s.done ? 'View' : 'Start'}</Link>
        </li>)}</ol>
      </Card>
      <div className="stack">
        <Card title="Needs attention">
          <ul className="queue">{work.map(w => <li key={w.label}><Link to={w.to} className={w.n ? 'waiting' : undefined}><strong>{w.n}</strong><span>{w.label}</span></Link></li>)}</ul>
        </Card>
        <Card title="Move in from QuickBooks Online">
          <p>Bring your chart of accounts, customers, vendors, an accountant-approved trial balance, open invoices and bills, and a read-only history archive. Preview first; nothing posts until it is signed off.</p>
          <Link className="btn btn-primary btn-block" to="/app/move-in">Preview a move-in</Link>
        </Card>
      </div>
    </div>
  </>
}
