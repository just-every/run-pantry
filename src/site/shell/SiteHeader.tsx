import { links } from './links'

/** The header on every run-site page: the lockup on the left; Docs, Contract and Source on the right, one row on phones too.
 * `overArt` lays it over the homepage's painted hero. */
export function SiteHeader({ current, overArt = false }: { current?: 'docs'; overArt?: boolean }) {
  return <header className={`site-header${overArt ? ' over-art' : ''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="site-wrap"><div className="site-header-row">
      <a className="site-brand" href={links.home}><img src="/brand/mark.svg" alt="" width="30" height="30" /><span>Pantry</span></a>
      <nav aria-label="Main">
        <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
        <a href={links.contract}>Contract</a>
        <a href={links.source}>Source</a>
      </nav>
    </div></div>
  </header>
}
