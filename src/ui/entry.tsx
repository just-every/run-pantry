// A shell entry: an ordinary link the router follows in place, marked current only where the shell
// says. The router's own Link marks every link whose path starts the address (so /app everywhere).
import { useNavigate } from '@tanstack/react-router'
import type { AnchorHTMLAttributes } from 'react'

export function Entry({ to, current = false, ...rest }: { to: string; current?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const navigate = useNavigate()
  return <a {...rest} href={to} aria-current={current ? 'page' : undefined} onClick={e => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault(); void navigate({ href: to })
  }} />
}
