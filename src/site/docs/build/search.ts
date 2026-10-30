/** Search the same rendered headings and text that the owner reads, with their actual ids. */
export type SearchSection = { anchor: string; titlePath: string[]; text: string }
export type SearchPage = { href: string; searchSections: SearchSection[] }

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const text = (html: string) => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#(\d+);|&#x([\da-f]+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (_, decimal, hex, named) =>
    decimal || hex ? String.fromCodePoint(parseInt(decimal || hex, decimal ? 10 : 16))
      : (entities[named.toLowerCase()] ?? ''))
  .replace(/\s+/g, ' ').trim()

export function searchSections(html: string, title: string, titleId: string): SearchSection[] {
  const sections: SearchSection[] = []
  let current: SearchSection = { anchor: titleId, titlePath: [title], text: '' }
  let parent = '', offset = 0
  const finish = (end: number) => {
    current.text = text(html.slice(offset, end))
    if (current.text) sections.push(current)
  }
  for (const match of html.matchAll(/<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
    finish(match.index)
    const heading = text(match[3])
    if (match[1] === '2') parent = heading
    current = { anchor: match[2], titlePath: [title, ...(match[1] === '3' && parent ? [parent] : []), heading], text: '' }
    offset = match.index + match[0].length
  }
  finish(html.length)
  return sections
}
