import { bodies, sections } from 'virtual:pantry-docs'
import type { DocsPage, DocsPageMeta, DocsSection } from './types'

// The published docs, parsed from docs/site.json and rendered at build time (build/plugin.ts), and lookups over them.

export const docsSections: DocsSection[] = sections
export const docsPages: DocsPageMeta[] = sections.flatMap(section => section.pages)
export const docsLead = 'Run Pantry on your own computer, keep the books with your bookkeeper and accountant, and close every month.'

/** The page with its body and contents list, or undefined for an unknown slug. */
export function getDocsPage(slug: string): DocsPage | undefined {
  const meta = docsPages.find(page => page.slug === slug)
  return meta && Object.hasOwn(bodies, slug) ? { ...meta, ...bodies[slug] } : undefined
}

/** The pages before and after `slug` in reading order, across sections. */
export function docsNeighbours(slug: string): { previous?: DocsPageMeta; next?: DocsPageMeta } {
  const index = docsPages.findIndex(page => page.slug === slug)
  return index === -1 ? {} : { previous: docsPages[index - 1], next: docsPages[index + 1] }
}

/** Document title and description: the docs home without a slug, a page with one. */
export function docsHead(slug?: string): { title: string; description: string } {
  const page = slug === undefined ? undefined : docsPages.find(entry => entry.slug === slug)
  return page ? { title: `${page.title} · Pantry docs`, description: page.summary } : { title: 'Docs · Pantry', description: docsLead }
}
