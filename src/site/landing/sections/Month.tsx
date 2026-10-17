import { FEED_BACK, FEED_DOWN, isWeekend, MOMENTS, type Moment } from '../book'
import { HeadSection, Icon } from '../parts'

// The ribbon's 33 slots: Oct 1–31, a break, then Nov 2. Each callout hangs from its day at `anchor` of its width,
// so the first ones open to the right, the last ones to the left, and none runs past the ribbon.
const slot = (m: { month: number; day: number }) => m.month === 11 ? 32 : m.day - 1
const at = (i: number) => `${(i / 32) * 100}%`
const ANCHOR: Record<string, number> = { 'Oct 1': .08, 'Oct 4': .46, 'Oct 9': .2, 'Oct 13': .42, 'Oct 20': .26, 'Oct 27': .94, 'Oct 31': .7, 'Nov 2': .76 }
// How many words of each callout's detail share its date's line, as drawn (0: the whole callout on one line).
const LEAD: Record<string, number> = { 'Oct 1': 1, 'Oct 4': 1, 'Oct 9': 1, 'Oct 13': 2, 'Oct 20': 2, 'Oct 27': 2, 'Oct 31': 0, 'Nov 2': 1 }
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

function Lines({ m }: { m: Moment }) {
  const words = m.detail.split(' '), n = LEAD[m.label] || words.length
  return <span className="rb-text"><span>{m.label} · {words.slice(0, n).join(' ')}</span>{n < words.length && <span>{words.slice(n).join(' ')}</span>}</span>
}

const Callout = ({ m }: { m: Moment }) =>
  <p className={`rb-call ${m.below ? 'below' : 'above'} tone-${m.tone}`} style={{ left: at(slot(m)), ['--anchor' as string]: ANCHOR[m.label] }}>
    <span className="rb-dot">{m.lock && <Icon name="lock" />}</span><Lines m={m} />
  </p>

function Ribbon() {
  return <div className="ribbon">
    <div className="rb-axis">
      <span className="rb-band down" style={{ left: at(FEED_DOWN[0] - 1.4), width: at(FEED_DOWN[1] - FEED_DOWN[0] + .9) }} />
      <span className="rb-band back" style={{ left: at(FEED_BACK[0] - 1.4), width: at(FEED_BACK[1] - FEED_BACK[0] + .9) }} />
      <span className="rb-line" /><span className="rb-line nov" />
      {DAYS.map(day => <span key={day} className={`rb-tick${isWeekend(10, day) ? ' weekend' : ''}`} style={{ left: at(day - 1) }}><span>{day}</span></span>)}
      <span className="rb-tick" style={{ left: at(32) }}><span>Nov 2</span></span>
      {MOMENTS.map(m => <span key={m.label} className={`rb-stem ${m.below ? 'below' : 'above'} tone-${m.tone}`} style={{ left: at(slot(m)) }} />)}
      {MOMENTS.filter(m => m.tone !== 'navy' && !m.lock).map(m => <span key={m.label} className={`rb-node tone-${m.tone}`} style={{ left: at(slot(m)) }} />)}
      {MOMENTS.map(m => <Callout key={m.label} m={m} />)}
    </div>
  </div>
}

/** The phone and tablet plan: the same eight days as a vertical rail, weekend dates in grey. */
function Rail() {
  return <ol className="rail">{MOMENTS.map(m =>
    <li key={m.label} className={`tone-${m.tone}${m.day === FEED_DOWN[0] && m.month === 10 ? ' gap' : ''}`}>
      <span className={`rail-date${isWeekend(m.month, m.day) ? ' weekend' : ''}`}>{m.label}</span>
      <span className="rail-node">{m.lock && <Icon name="lock" />}</span>
      <span className="rail-card">{m.detail}</span>
    </li>)}</ol>
}

export function Month() {
  return <HeadSection id="october" className="month" eyebrow="October 2026 · Alder Street Builders" title="A month in the books."
    body="One remodeling contractor, one bank, one card, Stripe, Gusto and an accountant. This is their October."
    label={`October 2026 for Alder Street Builders: ${MOMENTS.map(m => `${m.label}, ${m.detail}`).join('; ')}. The Amex feed was down Oct 20 to 22 and caught up from Oct 23.`}>
    <Ribbon /><Rail />
  </HeadSection>
}
