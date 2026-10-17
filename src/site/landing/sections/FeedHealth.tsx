import { AMEX, BACKFILL, FEEDS } from '../book'
import { Dots, Icon } from '../parts'

/** Oct 20–23: Pantry's own connection health (Chase, Stripe and Gusto connected; Amex needs a sign-in, said plainly,
 * with Re-link), the close exception it raised, and the re-link that filled the missed days without duplicates.
 * Drawn left, copy right, with the backfill card lapping the bottom of the feeds card (page-07). */
function Feeds() {
  return <div className="card feeds">
    <p className="card-title feeds-title">Bank and card feeds</p>
    <div className="fd-row fd-cols"><span>Connection</span><span>Status</span><span>Last successful sync</span><span>Next sync</span></div>
    {FEEDS.map(f => <div key={f.name} className={`fd-row${f.ok ? '' : ' broken'}`}>
      <b className="fd-name">{f.name}</b>
      <span className="fd-status"><span className={`chip ${f.ok ? 'chip-green' : 'chip-red'}`}>{f.ok ? 'Connected' : 'Sign-in needed'}</span></span>
      <span className="fd-sync dots"><span className="fd-last"><i>Last </i>{f.last}</span><span className="fd-next">{f.ok && <i>Next </i>}{f.next}</span></span>
      {!f.ok && <p className="fd-error"><span>American Express needs you to sign in again</span><span className="fd-relink">Re-link</span></p>}
    </div>)}
    <p className="fd-exception"><Icon name="box" /><Dots text={`October close · 1 exception · ${AMEX} not synced through Oct\u00a022`} /></p>
  </div>
}

function Backfill() {
  return <div className="card backfill">
    <p className="card-title"><Dots text="Re-linked Oct 23 · 41 transactions filled · no duplicates" /></p>
    {BACKFILL.map(([date, payee, amount, coded, how]) => <p key={date} className="bf-row"><span className="bf-date">{date}</span><span className="bf-payee">{payee}</span><span className="bf-amount">{amount}</span><span className="bf-coded">{coded}</span><span className="bf-how">{how}</span></p>)}
    <p className="bf-more">+ 38 more</p>
  </div>
}

const LABEL = `Bank and card feeds: ${FEEDS.map(f => `${f.name}, ${f.ok ? 'connected' : 'sign-in needed'}, last successful sync ${f.last}, next sync ${f.next}`).join('; ')}. American Express needs you to sign in again, with a Re-link button. October close has 1 exception: ${AMEX} not synced through Oct 22. Re-linked Oct 23: 41 transactions filled, no duplicates, including ${BACKFILL.map(([d, p, a, c, h]) => `${d} ${p} ${a} ${c} ${h}`).join('; ')}, and 38 more.`

export function FeedHealth() {
  return <section id="feed-health" className="sec feed-health" aria-labelledby="feed-health-title">
    <div className="site-wrap">
      <div className="fh-row">
        <div className="sec-art fh-feeds" role="img" aria-label={LABEL}><div className="sec-drawing" aria-hidden="true"><Feeds /></div></div>
        <div className="sec-copy">
          <p className="eyebrow">Oct 20–23 · A feed breaks</p>
          <h2 id="feed-health-title">When a feed breaks,{' '}<br />you see it.</h2>
          <p className="sec-body">Amex asked for a new sign-in. Pantry flagged the gap that morning and backfilled every missed day once Maya re-linked.</p>
        </div>
      </div>
      <div className="fh-backfill" aria-hidden="true"><Backfill /></div>
    </div>
  </section>
}
