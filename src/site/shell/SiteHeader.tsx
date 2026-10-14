import { links } from './links'

/** The header on every run-site page: the lockup on the left; Docs and Source on the right, one row on phones too. */
export function SiteHeader({ current }: { current?: 'docs' }) {
  return <header className="site-header">
    <a className="skip-link" href="#main">Skip to content</a>
    <div className="site-wrap site-header-row">
      <a className="site-brand" href={links.home}><img src="/brand/mark.svg" alt="" width="28" height="28" /><span>Pantry</span></a>
      <nav aria-label="Main">
        <a href={links.docs} aria-current={current === 'docs' ? 'page' : undefined}>Docs</a>
        <a href={links.source}>Source</a>
      </nav>
    </div>
  </header>
}
