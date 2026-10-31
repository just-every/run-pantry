// Tools: the seldom-used jobs in one place, each with its page's own line, as this role may open them.
import { Link } from '@tanstack/react-router'
import { PageHead, useShared } from './kit'
import { Icon } from './icons'
import { countText, offered } from './destinations'

const LINE: Record<string, string> = {
  '/app/agents': 'Your agent prepares; a person approves.',
  '/app/cash-planner': 'Estimates for thirteen weeks, with the records and assumptions behind each balance.',
  '/app/collections': 'Review the facts and exact message before sending.',
  '/app/documents': 'Receipts, vendor invoices and statements, kept exactly as uploaded.',
  '/app/assets': 'Review capital purchases, approve book depreciation and keep tax elections separate.',
  '/app/currency': 'Record a source-attested daily rate and compare an original foreign amount with its original USD record.',
  '/app/move-in': 'Bring your books from QuickBooks Online or Xero.',
}

export function Tools() {
  const { state } = useShared(), waiting = countText(state.overview?.queue?.proposals)
  return <>
    <PageHead title="Tools" />
    <ul className="card tool-list">{offered(state.actor).tools.map(t => <li key={t.to}><Link to={t.to} aria-description={t.to === '/app/agents' && waiting ? `${waiting} waiting` : undefined}>
      <span className="tool-text"><strong>{t.label}{t.to === '/app/agents' && waiting && <span className="tally" aria-hidden="true">{waiting}</span>}</strong><span>{LINE[t.to]}</span></span><Icon name="next" />
    </Link></li>)}</ul>
  </>
}
