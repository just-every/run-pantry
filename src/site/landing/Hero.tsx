import { Actions } from '../shell/Actions'
import { Lock, Rule, Tag, Tick, Tile } from './parts'

/** September 2026 closed: reconciled to $0.00, the checklist passed, the month locked and the package ready. */
function Steps() {
  return <ol className="hero-steps" aria-label="September 2026 reconciled, checked and locked">
    <li><p className="step-head"><span className="disc">1</span>Reconcile</p>
      <Tile label="Operating checking for September 2026 reconciled with a difference of $0.00">
        <p className="tile-title">Operating checking — September 2026</p>
        <div className="tile-split"><div><p className="tile-label">Difference</p><p className="figure"><Rule>$0.00</Rule></p></div><Tag>Reconciled</Tag></div>
      </Tile></li>
    <li><p className="step-head"><span className="disc">2</span>Check</p>
      <Tile label="Close checklist: bank accounts reconciled and trial balance balances; all checks passed">
        <p className="tile-title strong">Close checklist</p>
        <p className="tile-row">Bank accounts reconciled<Tick /></p>
        <p className="tile-row">Trial balance balances<Tick /></p>
        <p className="tile-center"><Tag>All checks passed</Tag></p>
      </Tile></li>
    <li><p className="step-head"><span className="disc">3</span>Lock</p>
      <Tile label="September locked; download the accountant package" className="tile-lock">
        <p className="tile-center"><Lock /><Tag>Locked</Tag></p>
        <p className="tile-center ruled"><Tag tone="outline">Download accountant package</Tag></p>
      </Tile></li>
  </ol>
}

export function Hero() {
  return <section className="hero" id="top" aria-labelledby="hero-title">
    <div className="site-wrap">
      <h1 id="hero-title">Books that close every month.</h1>
      <p className="hero-sub">Match the bank, pass the checklist, lock the month, and hand your accountant one package.</p>
      <p className="hero-alt">100% free, open source alternative to <strong>QuickBooks Online</strong> and <strong>Xero</strong></p>
      <Actions />
      <p className="hero-small">Free and open source, MIT licensed.</p>
      <Steps />
    </div>
  </section>
}
