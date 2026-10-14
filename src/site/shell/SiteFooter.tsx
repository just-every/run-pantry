import { links } from './links'

/** One line: the name, the licence and the source. */
export function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-wrap"><p>Pantry · MIT licensed · <a href={links.source}>Source</a></p></div>
  </footer>
}
