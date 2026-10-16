import { links } from '../../shell/links'
import { Icon } from '../parts'

const COMMANDS = ['git clone https://github.com/just-every/run-pantry.git pantry', 'cd pantry', 'rer install', 'rer setup', 'rer dev']
const OWN: [string, string, string][] = [['laptop', 'green', 'Your own computer'], ['database', 'apricot', 'Your books, your database'], ['export', 'green', 'Export any time']]

/** Run it yourself: the five commands in a terminal, and what owning it means. */
export function Ownership() {
  return <section id="ownership" className="feature ownership" aria-labelledby="ownership-title">
    <div className="site-wrap feature-row">
      <div className="feature-copy">
        <p className="eyebrow ink">Ownership</p>
        <h2 id="ownership-title">Yours, start<br />to finish.</h2>
        <p className="feature-body"><a href={links.run}>Run Pantry</a> on your own computer and keep every record. Export everything, any time.</p>
        <ul className="own-list">{OWN.map(([icon, tone, text]) => <li key={text}><span className={`own-icon ${tone}`}><Icon name={icon} /></span>{text}</li>)}</ul>
      </div>
      <div className="feature-art">
        <div className="terminal" role="img" aria-label={`Five commands: ${COMMANDS.join(', ')}`}>
          <div className="terminal-bar" aria-hidden="true"><span /><span /><span /></div>
          <pre aria-hidden="true">{COMMANDS.map(line => <span key={line} className="terminal-line"><span className="prompt">$</span>{line}{'\n'}</span>)}</pre>
        </div>
      </div>
    </div>
  </section>
}
