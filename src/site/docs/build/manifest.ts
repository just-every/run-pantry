import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DocsSection } from '../types.ts'

// docs/site.json lists the published pages in display order, grouped in sections. Each page names its slug, its title, its
// Markdown file in docs/ and a one-sentence summary. This reads it and enforces the rules; every problem is listed at once.

export const docsDirectory = 'docs'
export const manifestPath = `${docsDirectory}/site.json`
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function readManifest(root: string): DocsSection[] {
  const raw = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'))
  const problems: string[] = []
  const slugs = new Set<string>()
  const files = new Set<string>()
  const sections: DocsSection[] = (Array.isArray(raw?.sections) ? raw.sections : []).map((section: Record<string, unknown>, s: number) => {
    const title = text(section.title)
    if (!title) problems.push(`section ${s + 1} has no title`)
    const entries: Record<string, unknown>[] = Array.isArray(section.pages) ? section.pages : []
    if (!entries.length) problems.push(`section "${title}" has no pages`)
    return {
      title,
      pages: entries.map((page, p) => {
        const where = `page ${p + 1} of "${title}"`
        const slug = text(page.slug), pageTitle = text(page.title), file = text(page.file), summary = text(page.summary)
        const source = page.source === undefined ? 'docs' : page.source
        if (source !== 'docs' && source !== 'repository') problems.push(`${where}: source must be docs or repository`)
        if (!slugPattern.test(slug)) problems.push(`${where}: slug "${slug}" must be lowercase words joined by hyphens`)
        if (slugs.has(slug)) problems.push(`${where}: slug "${slug}" is used twice`)
        slugs.add(slug)
        if (!pageTitle) problems.push(`${where}: no title`)
        if (!summary) problems.push(`${where}: no summary`)
        const path = join(root, source === 'repository' ? '.' : docsDirectory, file)
        if (!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md$/.test(file)) problems.push(`${where}: file "${file}" must be a relative Markdown path without traversal`)
        else if (!existsSync(path) || !statSync(path).isFile()) problems.push(`${where}: ${docsDirectory}/${file} does not exist`)
        const identity = `${source}/${file}`
        if (files.has(identity)) problems.push(`${where}: ${identity} is listed twice`)
        files.add(identity)
        return { slug, title: pageTitle, file, source: source === 'repository' ? 'repository' : 'docs', summary, section: title }
      }),
    }
  })
  if (!sections.length) problems.push('no sections')
  if (problems.length) throw new Error(`${manifestPath} is invalid:\n- ${problems.join('\n- ')}`)
  return sections
}
