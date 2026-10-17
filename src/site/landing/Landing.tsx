import { SiteHeader } from '../shell/SiteHeader'
import { Hero } from './Hero'
import { Agent } from './sections/Agent'
import { Close } from './sections/Close'
import { Closing } from './sections/Closing'
import { FeedHealth } from './sections/FeedHealth'
import { Interlude } from './sections/Interlude'
import { Invoices } from './sections/Invoices'
import { Ledger } from './sections/Ledger'
import { Month } from './sections/Month'
import { MoveIn } from './sections/MoveIn'
import { Receipts } from './sections/Receipts'
import { Reports } from './sections/Reports'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/cards.css'
import '../styles/sections/month.css'
import '../styles/sections/move-in.css'
import '../styles/sections/ledger.css'
import '../styles/sections/receipts.css'
import '../styles/sections/invoices.css'
import '../styles/sections/feed-health.css'
import '../styles/sections/agent.css'
import '../styles/sections/close.css'
import '../styles/sections/reports.css'

/**
 * run-pantry.com's homepage, built from the owner-approved page structure (17 Oct 2026, page-s1): one month of one
 * business's books, in the order a small-business owner lives it. The hero; October on one ribbon; moving in (Sep 30);
 * the feeds (Oct 1–19); receipts (Oct 13); invoices (Oct 4–19); a feed that breaks (Oct 20–23); the books agent
 * (Oct 27); the interlude (Oct 31); the close with the accountant (Nov 2); the reports (Nov 3); the closing with the
 * footer. Painted art appears only in the hero, the interlude and the closing; every other drawing is HTML and CSS.
 */
export function Landing() {
  return <>
    <SiteHeader overArt />
    <main id="main">
      <Hero />
      <div className="sections">
        <Month /><MoveIn /><Ledger /><Receipts /><Invoices /><FeedHealth /><Agent />
      </div>
      <Interlude />
      <div className="sections">
        <Close /><Reports />
      </div>
      <Closing />
    </main>
  </>
}
