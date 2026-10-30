import { SearchField } from './search/SearchField'
import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsPath } from '../shell/links'
import { Arrow } from '../shell/Actions'
import { docsLead, docsSections } from './pages'
import { TitleDots } from './TitleDots'
import '../styles/site.css'
import '../styles/cards.css'
import '../styles/docs.css'

/** The docs home: every section as a row of white cards, each page's title over its one-line summary. */
export function DocsIndex() {
  return <>
    <SiteHeader current="docs" />
    <div className="docs-page"><main id="main" className="site-wrap docs-home">
      <header className="docs-home-head"><p className="eyebrow-docs">Pantry</p><h1 id="docs-title">Docs</h1><TitleDots /><p className="docs-summary">{docsLead}</p></header>
      <div className="docs-home-search"><SearchField id="docs-search-home" /></div>
      {docsSections.map((section, index) => <section key={section.title} aria-labelledby={`docs-section-${index}`} className="docs-home-section">
        <h2 id={`docs-section-${index}`}>{section.title}</h2>
        <ul className="docs-cards">{section.pages.map(page => <li key={page.slug}><a className="card docs-card" href={docsPath(page.slug)}><span className="docs-card-title">{page.title}</span><span className="docs-card-summary">{page.summary}</span><Arrow /></a></li>)}</ul>
      </section>)}
    </main></div>
    <SiteFooter />
  </>
}
