// The run site (run-pantry.com) `rer build --site` writes: the homepage with its
// Run action, /run, the docs from docs/*.md, /contract from CONTRACT.md, and the not-found page. Every Run
// page string and command is in run.json; nothing here reads installation data.
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { contractPageHtml } from '../base/contract-page'
import { hostingPageHtml } from '../base/hosting-page'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { DocsArticle } from './docs/DocsArticle'
import { DocsIndex } from './docs/DocsIndex'
import { docsHead, docsPages, docsSections, getDocsPage } from './docs/pages'
import { SearchField } from './docs/search/SearchField'
import { searchSections, type SearchPage } from './docs/build/search'
import { Landing } from './landing/Landing'
import run from './run.json'
import { runPricing } from '../base/run-pricing'
import { SiteHeader } from './shell/SiteHeader'

// Code cards get their Copy button only when script runs; without it the command is still there to select.
const COPY = "document.querySelectorAll('.docs-copy').forEach(b=>{b.hidden=false;b.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(b.closest('.docs-code').querySelector('code').textContent);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy'},1600)}catch{}})})"

const SHARE_IMAGE = `${identity.runSite}/site/share.jpg`

// Pantry’s header skips to this target on Base-rendered pages too.
const withMainTarget = (html: string) => html.replace('<main>', '<main id="main">')

export function sitePages({ styles, clients, contract, hosting }: SiteContext): SiteBuild {
  const data: RunData = { ...run, pricing: runPricing }
  const homepageHeader = { html: renderToStaticMarkup(<SiteHeader />), styles }
  const document = (title: string, description: string, body: ReactElement, script = '') => '<!doctype html>' + renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="theme-color" content="#f7f6fb" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Pantry" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={SHARE_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/brand/favicon-32.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preload" href="/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/figtree/figtree-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/fonts/fonts.css" />
        <link rel="stylesheet" href={identity.theme} />
        {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}
      </head>
      <body>{body}{script ? <script dangerouslySetInnerHTML={{ __html: script }} /> : null}</body>
    </html>,
  )
  const head = (slug?: string) => { const { title, description } = docsHead(slug); return [title, description] as const }
  const hostingHtml = withMainTarget(hostingPageHtml(identity, data, hosting ?? null, contract, homepageHeader))
    .replace('<h1>', '<h1 id="docs-title">')
  const searchPages: SearchPage[] = [
    { href: '/docs', searchSections: [{ anchor: 'docs-title', titlePath: ['Docs'], text: docsSections.flatMap(section => section.pages.map(page => `${page.title}. ${page.summary}`)).join(' ') }] },
    ...docsPages.map(page => ({ href: `/docs/${page.slug}`, searchSections: searchSections(
      page.slug === 'hosting' ? hostingHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)![1] : getDocsPage(page.slug)!.html,
      page.title, 'docs-title') })),
  ]
  // Static local previews use these exact sections when the semantic service is unavailable.
  const corpus = `<script id="docs-search-corpus" type="application/json">${JSON.stringify(searchPages).replaceAll('<', '\\u003c')}</script>`
  const searchClient = `<script type="module" src="${clients.docsSearch}"></script>`
  const enhanceDocs = (html: string, index = false) => html.replace('</body>', `${index ? corpus : ''}${searchClient}</body>`)
  return {
    searchPages,
    pages: [
      { path: '/', html: document('Pantry — Know where every dollar went', identity.tagline, <Landing />) },
      { path: '/run', html: withMainTarget(runPageHtml(identity, data, contract, homepageHeader)) },
      ...(contract ? [{ path: '/contract', html: contractPageHtml(identity, data, contract) }] : []),
      { path: '/docs', html: enhanceDocs(document(...head(), <DocsIndex />), true) },
      { path: '/docs/hosting', html: enhanceDocs(hostingHtml.replace('<main id="main">', `<main id="main"><div class="docs-hosting-search">${renderToStaticMarkup(<SearchField id="docs-search-hosting" />)}</div>`)) },
      ...docsPages.filter(page => page.slug !== 'hosting').map(page => ({ path: `/docs/${page.slug}`, html: enhanceDocs(document(...head(page.slug), <DocsArticle slug={page.slug} />, COPY)) })),
      { path: '/404', html: siteNotFoundHtml(identity, data) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand', 'site', 'favicon.ico', 'apple-touch-icon.png'],
  }
}
