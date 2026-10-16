import { Check, Feature, Icon } from '../parts'

function AgentCard() {
  return <div className="card agent">
    <div className="agent-head"><span className="agent-icon"><Icon name="swap" /></span><p>Unexplained transfer · $1,200 · Oct 9</p></div>
    <p className="bubble out">Asked Maya by text: What was this?</p>
    <p className="bubble in"><span className="avatar lav">M</span><span>Owner draw</span></p>
    <p className="agent-ask">Recode to Owner&rsquo;s draw?</p>
    <p className="agent-effect"><Icon name="bars" />Net income Oct: $9,840 → $11,040</p>
    <div className="agent-actions"><span className="btn btn-navy">Approve</span><span className="btn btn-ghost">Not now</span></div>
  </div>
}

const CLOSE = ['Chase ••4417 reconciled', 'Amex ••1009 reconciled', 'Stripe clearing reconciled', '2 questions answered']

function CloseCard() {
  return <div className="card close">
    <p className="close-title">October 2026 close</p>
    <ul className="close-list">{CLOSE.map(item => <li key={item}><Check />{item}</li>)}</ul>
    <p className="close-lock"><span className="lock-chip"><Icon name="lock" /></span>Locked by Jordan Kim, CPA · Nov 3</p>
    <p className="bubble in wide"><span className="avatar lav">JK</span><span>Looks right, closing October.</span></p>
  </div>
}

export function BooksAgent() {
  return <Feature id="books-agent" eyebrow="The books agent" title={<>It chases the<br />loose ends.</>} art={<AgentCard />}
    label="An unexplained $1,200 transfer on Oct 9. Pantry asked Maya by text what it was; she answered owner draw. Recoding it to Owner's draw moves October net income from $9,840 to $11,040, waiting for Approve or Not now.">
    Pantry follows up on what doesn&rsquo;t add up, and shows you the change before anything moves.
  </Feature>
}

export function MonthEnd() {
  return <Feature id="month-end" flip eyebrow="Month-end close" title={<>Closed, with<br />your accountant.</>} art={<CloseCard />}
    label="October 2026 close: Chase ••4417, Amex ••1009 and Stripe clearing reconciled, 2 questions answered, locked by Jordan Kim, CPA on Nov 3, who wrote: Looks right, closing October.">
    Reconcile, answer the open questions, lock the month. Your accountant signs off in the same place.
  </Feature>
}
