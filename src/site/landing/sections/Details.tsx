import { Icon } from '../parts'

const DETAILS: [string, string, string, string][] = [
  ['bank', 'lavender', 'Bank rules', 'Teach it once, and routine transactions file themselves.'],
  ['receipt', 'green', '1099 tracking', 'Contractors flagged at the IRS threshold ($2,000 from 2026), forms ready in January.'],
  ['clock', 'apricot', 'Audit trail', 'Every change records who, what and when.'],
  ['lock', 'apricot', 'Locked periods', 'Closed months stay closed.'],
  ['clip', 'lavender', 'Attachments everywhere', 'Every entry keeps its receipt or bill.'],
  ['export', 'green', 'Export everything', 'CSV and a full database export, any time.'],
]

/** Six smaller things done properly, as a 3×2 grid of cards. */
export function Details() {
  return <section id="details" className="details" aria-labelledby="details-title">
    <div className="site-wrap">
      <p className="eyebrow">Also included</p>
      <h2 id="details-title">The quiet<br />details.</h2>
      <ul className="details-grid">{DETAILS.map(([icon, tone, title, body]) => <li key={title} className="card detail"><span className={`detail-icon ${tone}`}><Icon name={icon} /></span><h3>{title}</h3><p>{body}</p></li>)}</ul>
    </div>
  </section>
}
