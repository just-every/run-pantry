// Needs attention: every job waiting for a person as one list, grouped by the page that does
// it. The first question is answered in place; every other row opens the page that does the job.
// Nothing at zero is shown.
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Action, command, usd, useShared, type D } from './kit'
import { Icon } from './icons'
import { shortMonth } from './display-time'
import { relink } from './bank-feeds'
import { QuestionAnswer, StatusChip } from './questions'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function Row({ to, search, figure, state, children }: { to: string; search?: D; figure?: ReactNode; state?: string; children: ReactNode }) {
  return <li><Link to={to} search={search as any} className="attention-row">
    <span className="row-text">{children}</span>{(figure || state) && <span className="row-meta">{figure && <span className="fig">{figure}</span>}{state && <span className="row-state">{state}</span>}</span>}<Icon name="next" />
  </Link></li>
}

const More = ({ to, children }: { to: string; children: ReactNode }) => <li><Link to={to} className="attention-more">{children}</Link></li>

type Group = { title: string; count?: number; rows: ReactNode[] }

export function NeedsAttention({ home: h, onDone }: { home: D; onDone: () => Promise<void> }) {
  const can = useShared().state.actor.can.record, first = h.questions.first
  const groups: Group[] = [
    h.questions.total > 0 && { title: 'Questions from Pantry', count: h.questions.total, rows: [
      first && <li key={first.id} className="attention-first">
        <div className="first-head"><Link to="/app/questions" search={{ q: first.id }}>{first.title}</Link><StatusChip status={first.status} /></div>
        <p className="first-ask">{first.question}</p>
        <QuestionAnswer q={first} onDone={onDone} compact inline />
      </li>,
      ...h.questions.next.map((x: D) => <Row key={x.id} to="/app/questions" search={{ q: x.id }}>{x.title}</Row>),
      h.questions.total > 1 + h.questions.next.length && <More key="more" to="/app/questions">{plural(h.questions.total - 1 - h.questions.next.length, 'more question')}</More>,
    ] },
    (h.feedAlerts.length > 0 || h.unmatchedLines > 0) && { title: 'Bank', rows: [
      ...h.feedAlerts.map((n: D) => <li key={n.itemId} className="attention-alert">
        <Link to="/app/bank" className="alert-link">{n.message.replace(/\.$/, '')} <small>{n.name}</small></Link>
        {can && <Action run={async () => { if (n.requiresRelink) await relink({ id: n.itemId }); else await command('feed.sync', { itemId: n.itemId }); await onDone() }}>{n.requiresRelink ? 'Re-link' : 'Sync now'}</Action>}
        <Icon name="next" />
      </li>),
      h.unmatchedLines > 0 && <Row key="lines" to="/app/bank">{plural(h.unmatchedLines, 'unmatched statement line')}</Row>,
    ] },
    (h.invoiceDrafts.total > 0 || h.billsToApprove > 0) && { title: 'Sales & bills', count: h.billsToApprove ? undefined : h.invoiceDrafts.total, rows: [
      ...h.invoiceDrafts.rows.map((i: D) => <Row key={i.id} to="/app/sales" search={{ invoice: i.id }} figure={usd(i.total_cents)} state={i.status === 'draft' ? 'Draft' : 'Approved'}>{i.customer} <span className="sub">{i.number}</span></Row>),
      h.invoiceDrafts.total > h.invoiceDrafts.rows.length && <More key="more" to="/app/sales">{plural(h.invoiceDrafts.total - h.invoiceDrafts.rows.length, 'more invoice draft')}</More>,
      h.billsToApprove > 0 && <Row key="bills" to="/app/sales" search={{ tab: 'bills' }}>{plural(h.billsToApprove, 'bill')} to approve</Row>,
    ] },
    h.receipts.total > 0 && { title: 'Receipts', count: h.receipts.total, rows: [
      ...h.receipts.rows.map((r: D) => <Row key={r.id} to="/app/receipts" figure={r.total_cents === null ? undefined : usd(r.total_cents)}>{r.vendor || r.file}</Row>),
      h.receipts.total > h.receipts.rows.length && <More key="more" to="/app/receipts">{plural(h.receipts.total - h.receipts.rows.length, 'more receipt')}</More>,
    ] },
    h.journalDrafts.total > 0 && { title: 'Books', count: h.journalDrafts.total, rows: [
      ...h.journalDrafts.rows.map((e: D) => <Row key={e.id} to="/app/books" search={{ tab: 'journal' }} figure={usd(e.total_cents)} state="Draft">{e.memo}</Row>),
      h.journalDrafts.total > h.journalDrafts.rows.length && <More key="more" to="/app/books">{plural(h.journalDrafts.total - h.journalDrafts.rows.length, 'more draft')}</More>,
    ] },
    h.proposals.total > 0 && { title: 'Agent work', count: h.proposals.total, rows: [
      ...h.proposals.rows.map((p: D) => <Row key={p.id} to="/app/agents">{p.summary}</Row>),
      h.proposals.total > h.proposals.rows.length && <More key="more" to="/app/agents">{plural(h.proposals.total - h.proposals.rows.length, 'more proposal')}</More>,
    ] },
    (h.reopenRequests > 0 || h.missingByMonth.length > 0) && { title: 'Close', rows: [
      h.reopenRequests > 0 && <Row key="reopen" to="/app/close">{plural(h.reopenRequests, 'reopening request')}</Row>,
      ...h.missingByMonth.map((m: D) => <Row key={m.month} to="/app/close" search={{ period: m.month }}>{shortMonth(m.month)} · {plural(m.count, 'missing source document')}</Row>),
    ] },
  ].filter(Boolean) as Group[]
  return <section className="attention" aria-labelledby="needs-attention">
    <h2 id="needs-attention">Needs attention</h2>
    {groups.length ? <div className="card attention-list">{groups.map(g => <section key={g.title} className="attention-group" aria-label={g.title}>
      <h3>{g.title}{g.count ? <> · {g.count}</> : null}</h3><ul>{g.rows}</ul>
    </section>)}</div> : <p className="lead">Nothing needs attention.</p>}
  </section>
}
