import { Actions } from '../shell/Actions'
import { HeroCards } from './HeroCards'
import { BAND_WIDTHS, Painting } from './parts'

/** The painted sunrise lookout, the promise and the action, with October's books tied together on the right. */
export function Hero() {
  return <section className="hero" aria-labelledby="hero-title">
    <Painting className="hero-art" name="hero" widths={BAND_WIDTHS} sizes="100vw" eager phone={{ name: 'hero-phone', widths: [640, 1016], media: '(max-width: 760px)' }} />
    <div className="site-wrap hero-grid">
      <div className="hero-copy">
        <h1 id="hero-title">Know where <span className="brush">every dollar</span> went.</h1>
        <p className="hero-sub">Pantry pulls in your bank and cards, catches every receipt, gets invoices paid, and closes the month with your accountant.</p>
        <p className="hero-alt">100% free, open source alternative to <br /><strong>QuickBooks Online</strong>, <strong>Xero</strong> and <strong>FreshBooks</strong></p>
        <Actions />
      </div>
      <HeroCards />
    </div>
  </section>
}
