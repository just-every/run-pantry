import { Actions } from '../shell/Actions'

const INCLUDED = ['CSV and OFX statements', 'Owner, bookkeeper and accountant roles', 'Locked months refuse changes', 'Documents kept exactly as uploaded', 'Every approval recorded', 'Export and restore the whole book']

export function Included() {
  return <section className="included" id="included" aria-labelledby="included-title">
    <div className="site-wrap">
      <h2 id="included-title">Also included</h2>
      <ul className="included-grid">{INCLUDED.map(item => <li key={item} className="tile tile-small"><div className="tile-face"><p>{item}</p><span className="mini-rule" aria-hidden="true" /></div></li>)}</ul>
    </div>
  </section>
}

export function Closing() {
  return <section className="closing" id="run" aria-labelledby="run-title">
    <div className="site-wrap"><h2 id="run-title">Close your next month in Pantry.</h2><Actions /></div>
  </section>
}
