import { SiteHeader } from '../shell/SiteHeader'
import { Hero } from './Hero'
import { BankFeeds, Receipts } from './sections/Banking'
import { BooksAgent, MonthEnd } from './sections/Books'
import { Closing } from './sections/Closing'
import { Details } from './sections/Details'
import { Invoices, Numbers } from './sections/GettingPaid'
import { Interlude } from './sections/Interlude'
import { Connected, MoveIn } from './sections/Moving'
import { Ownership } from './sections/Ownership'
import '../styles/site.css'
import '../styles/landing.css'
import '../styles/cards.css'

/**
 * run-pantry.com's homepage, built from the design desk's approved page (16 Oct 2026, page v3) in its order:
 * hero; bank feeds and receipts; invoices and every number; the books agent and the close; the interlude;
 * connected services and moving in; ownership; the quiet details; the closing with the footer.
 * Painted art appears only in the hero, the interlude and the closing; every other drawing is HTML and CSS.
 */
export function Landing() {
  return <>
    <SiteHeader overArt />
    <main id="main">
      <Hero />
      <BankFeeds /><Receipts />
      <Invoices /><Numbers />
      <BooksAgent /><MonthEnd />
      <Interlude />
      <Connected /><MoveIn />
      <Ownership />
      <Details />
      <Closing />
    </main>
  </>
}
