import { SiteFooter } from '../shell/SiteFooter'
import { SiteHeader } from '../shell/SiteHeader'
import { docsPath } from '../shell/links'
import { docsLead, docsSections } from './pages'
import '../styles/site.css'
import '../styles/docs.css'

/** The docs home: every section as a row of stoneware tiles, each page's title over its one-line summary. */
export function DocsIndex() {
  return <>
    <SiteHeader current="docs" />
    <main id="main" className="site-wrap docs-home">
      <header className="docs-home-head"><p className="eyebrow">Docs</p><h1>Pantry docs</h1><p className="docs-summary">{docsLead}</p></header>
      {docsSections.map((section, index) => <section key={section.title} aria-labelledby={`docs-section-${index}`} className="docs-home-section">
        <h2 id={`docs-section-${index}`}>{section.title}</h2>
        <ul className="docs-cards">{section.pages.map(page => <li key={page.slug}><a className="tile docs-card" href={docsPath(page.slug)}><span className="docs-card-title">{page.title}</span><span className="docs-card-summary">{page.summary}</span><span className="mini-rule" aria-hidden="true" /></a></li>)}</ul>
      </section>)}
    </main>
    <SiteFooter />
  </>
}
