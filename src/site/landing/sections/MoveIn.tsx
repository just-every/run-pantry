import { ACCOUNTANT, SETUP, TIE_OUT, TRIAL_BALANCE } from '../book'
import { Check, SideSection } from '../parts'

/** Sep 30, the move-in: QuickBooks Online's trial balance tied to Pantry's, and the commands that start Pantry. */
function TrialBalance() {
  return <div className="card tb">
    <p className="tb-title"><span className="dots"><span>Trial balance check</span><span className="tb-date">Sep 30, 2026</span></span></p>
    <div className="tb-pair"><div><p>QuickBooks Online</p><b>{TRIAL_BALANCE}</b></div><div><p>Pantry</p><b>{TRIAL_BALANCE}</b></div></div>
    <p className="tb-match"><Check />Matched to the cent</p>
    <table className="tb-table">
      <thead><tr><th /><th>QuickBooks</th><th>Pantry</th></tr></thead>
      <tbody>{TIE_OUT.map(([what, qbo, pantry]) => <tr key={what}><td>{what}</td><td>{qbo}</td><td>{pantry}</td></tr>)}</tbody>
    </table>
    <p className="tb-sign">Signed off by {ACCOUNTANT} <span>· Sep 30</span></p>
  </div>
}

// A command breaks only between words (never at a hyphen, as in "run-" / "pantry"), keeps the installer's
// `install.sh | sh` together, and may break after the installer's host.
function breakable(line: string) {
  return line.split(/(\S*install\.sh \| sh|\S+)/).map((part, i) => {
    const pipe = /^(.*\/)(install\.sh \| sh)$/.exec(part)
    if (pipe) return <span key={i}><span className="nowrap">{pipe[1]}</span><wbr /><span className="nowrap">{pipe[2]}</span></span>
    return part.trim() ? <span className="nowrap" key={i}>{part}</span> : part
  })
}

function Terminal() {
  return <div className="terminal">
    <div className="terminal-bar"><span /><span /><span /></div>
    <pre>{SETUP.map(line => line.startsWith('# ')
      ? <span className="terminal-line terminal-comment" key={line}><span className="prompt">#</span>{breakable(line.slice(2))}{'\n'}</span>
      : <span className="terminal-line" key={line}><span className="prompt">$</span>{breakable(line)}{'\n'}</span>)}</pre>
  </div>
}

export function MoveIn() {
  return <SideSection id="move-in" artFirst className="move-in" eyebrow="Sep 30 · Moving in" title={<>Bring your books<br />with you.</>}
    body="Import from QuickBooks Online or Xero. Balances, open items and attachments tie out before you switch."
    extra={<Terminal />}
    label={`Trial balance check, Sep 30, 2026: QuickBooks Online ${TRIAL_BALANCE} and Pantry ${TRIAL_BALANCE}, matched to the cent. ${TIE_OUT.map(([what, qbo, pantry]) => `${what}: ${qbo} in QuickBooks, ${pantry} in Pantry`).join('; ')}. Signed off by ${ACCOUNTANT} on Sep 30.`}>
    <TrialBalance />
  </SideSection>
}
