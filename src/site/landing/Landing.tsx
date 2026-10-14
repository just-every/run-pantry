import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { Features } from './Features'
import { Hero } from './Hero'
import { Closing, Included } from './Included'
import '../styles/site.css'
import '../styles/landing.css'

/** run-pantry.com's homepage. Its one action, Run Pantry, opens /run. Visual authority: the 12ui landing picks. */
export function Landing() {
  return <>
    <SiteHeader />
    <main id="main"><Hero /><Features /><Included /><Closing /></main>
    <SiteFooter />
  </>
}
