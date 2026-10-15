import { links } from './links'

const Arrow = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" /></svg>

/** The page's one action, Run Pantry (the dark pill), and the docs beside it. */
export function Actions() {
  return <div className="site-actions">
    <a className="site-pill" href={links.run}>Run Pantry<Arrow /></a>
    <a className="site-pill" href="https://demo.run-pantry.com/">Try the demo<Arrow /></a>
    <a className="site-link" href={links.docs}>Read the docs</a>
  </div>
}
