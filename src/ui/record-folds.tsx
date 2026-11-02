// The pieces a record is made of: a section that folds in place, and a link to another page of the app
// that navigates in the browser instead of loading a document.
import { useRouter } from '@tanstack/react-router'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

/** A closed-by-default section: today's `.details` with a bold ink summary, opening in place. A chip or figure sits at the right of its row. */
export function Fold({ title, chip, open = false, children }: { title: ReactNode; chip?: ReactNode; open?: boolean; children: ReactNode }) {
  return <details className="details fold" open={open || undefined}><summary><span>{title}</span>{chip}</summary><div className="fold-body">{children}</div></details>
}

/** A link whose address is built by the server: unchanged, but followed as a navigation inside the app. */
export function RecordLink({ href, children, ...rest }: { href: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const router = useRouter()
  return <a href={href} {...rest} onClick={e => {
    rest.onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return
    if (!href.startsWith('/app/') || href.startsWith('/api/')) return
    e.preventDefault(); router.history.push(href)
  }}>{children}</a>
}
