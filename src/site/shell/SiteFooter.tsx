import { links } from './links'

/** One line: the lockup, then Docs, Source and the licence. `tone="on-art"` is the homepage's, over the closing painting. */
export function SiteFooter({ tone = 'paper' }: { tone?: 'paper' | 'on-art' }) {
  return <footer className={`site-footer ${tone}`}>
    <div className="site-wrap"><div>
      <a className="site-brand" href={links.home}><img src={tone === 'on-art' ? '/brand/pantry-light.svg' : '/brand/pantry.svg'} alt="" width="22" height="22" /><span>Pantry</span></a>
      <nav aria-label="Footer"><a href={links.docs}>Docs</a><a href={links.source}>Source</a><a href={`${links.source}/blob/main/LICENSE`}>MIT licensed</a></nav><div className="site-contributors"><p>For contributors</p><a href={links.contract}>Build progress</a></div>
    </div></div>
  </footer>
}
