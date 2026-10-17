import { CASES, FOR_JORDAN } from '../book'
import { Check, Dots, Icon, SideSection } from '../parts'

/** Oct 9–27: the books agent's work log. Each mismatch it chased ends in an outcome, and the one judgment call
 * waits for the accountant. */
function WorkLog() {
  return <div className="card worklog">
    <p className="wl-title">Agent work log · October</p>
    {CASES.map(c => <div key={c.title} className="wl-case">
      <span className={`wl-icon ${c.tone}`}><Icon name={c.icon} /></span>
      <div className="wl-body">
        <p className="wl-head"><span><b>{c.title}</b>{c.when && <span> · {c.when}</span>}</span><span className="chip chip-green wl-outcome">{c.outcome}</span></p>
        <ul>{c.steps.map(step => <li key={step}><Check /><Dots text={step} /></li>)}</ul>
        {c.result && <p className="wl-result"><Dots text={c.result} /></p>}
      </div>
    </div>)}
    <p className="wl-ask"><Icon name="clock" /><span>{FOR_JORDAN}</span></p>
  </div>
}

export function Agent() {
  return <SideSection id="books-agent" className="agent-sec" eyebrow="Oct 27 · The books agent" title={<>Loose ends,<br />chased down.</>}
    body="The agent follows each mismatch across your bank, payroll and inbox until the ledger and the evidence agree. Each fix shows what it changed in the report."
    extra={<p className="agent-tally">3 resolved · 1 left for Jordan</p>}
    label={`Agent work log, October: ${CASES.map(c => `${c.title}${c.when ? `, ${c.when}` : ''}: ${c.steps.join('; ')}${c.result ? `; ${c.result}` : ''}; outcome ${c.outcome}`).join('. ')}. ${FOR_JORDAN}`}>
    <WorkLog />
  </SideSection>
}
