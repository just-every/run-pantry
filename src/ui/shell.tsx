// The signed-in shell: Pantry, five work destinations plus More, and who is
// signed in. On a phone all six move to a bottom bar.
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { api, Loading, ROLE_LABEL, SharedState, type D } from './kit'
import { Icon } from './icons'

const MAIN = [
  { to: '/app/sales', label: 'Sales & bills', short: 'Sales', icon: 'invoice' },
  { to: '/app/bank', label: 'Bank', short: 'Bank', icon: 'bank' },
  { to: '/app/books', label: 'Books', short: 'Books', icon: 'book' },
  { to: '/app/close', label: 'Close', short: 'Close', icon: 'check' },
  { to: '/app/reports', label: 'Reports', short: 'Reports', icon: 'chart' },
] as const
const MORE = [
  { to: '/app', label: 'Overview' },
  { to: '/app/move-in', label: 'Move in from QuickBooks' },
  { to: '/app/agents', label: 'Agent work' },
  { to: '/app/documents', label: 'Documents' },
  { to: '/app/settings', label: 'People & settings' },
  { to: '/app/activity', label: 'Activity' },
] as const

function More({ path }: { path: string }) {
  const [open, setOpen] = useState(false), ref = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', key); document.addEventListener('mousedown', click)
    ref.current?.querySelector<HTMLAnchorElement>('a')?.focus()
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click) }
  }, [open])
  const active = MORE.some(m => m.to === path)
  return <div className="more" ref={ref}>
    <button ref={button} type="button" className={`nav-link${active ? ' active' : ''}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(o => !o)}><Icon name="more" /><span>More</span></button>
    {open && <div className="more-menu" role="menu">{MORE.map(m => <Link key={m.to} to={m.to} role="menuitem" onClick={() => setOpen(false)} aria-current={path === m.to ? 'page' : undefined}>{m.label}</Link>)}</div>}
  </div>
}

export function Shell() {
  const path = useRouterState({ select: s => s.location.pathname.replace(/\/$/, '') || '/app' })
  const [state, setState] = useState<D>(), [error, setError] = useState('')
  const reload = useCallback(async () => { try { setState(await api('state')); setError('') } catch (e) { setError((e as Error).message) } }, [])
  useEffect(() => { void reload() }, [reload])
  return <div className="app">
    <HydrationUnit><header className="app-header">
      <Link to="/app" className="brand"><img src="/brand/mark.svg" alt="" width="28" height="28" />Pantry</Link>
      <nav className="app-nav" aria-label="Work">
        {MAIN.map(m => <Link key={m.to} to={m.to} className={`nav-link${path.startsWith(m.to) ? ' active' : ''}`} aria-current={path.startsWith(m.to) ? 'page' : undefined}><Icon name={m.icon} /><span className="wide-label">{m.label}</span><span className="short-label">{m.short}</span></Link>)}
        <More path={path} />
      </nav>
      {state && <div className="profile"><span className="profile-name">{state.actor.name}</span><small>{ROLE_LABEL[state.actor.role]}</small></div>}
    </header></HydrationUnit>
    <main className="workspace">
      {state ? <SharedState.Provider value={{ state, reload }}><Outlet /></SharedState.Provider> : <Loading error={error} what="your books" />}
    </main>
  </div>
}
