// The signed-in shell: Pantry's mark, Overview and the daily jobs as tabs with live counts,
// and at the right search, Tools, Settings and who is signed in. Narrower windows use short
// labels, then a top bar, a bottom bar of four jobs and a Menu that holds everything.
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { HydrationUnit } from '../base/hydration/unit'
import { api, Loading, ROLE_LABEL, SharedState, type D } from './kit'
import { Icon } from './icons'
import { Tip } from './tip'
import { Entry } from './entry'
import { OwnerMenu } from './owner-menu'
import { AppMenu } from './app-menu'
import { countText, currentEntry, offered, SEARCH, SETTINGS, TOOLS_PAGE, type Job } from './destinations'
import { roleScreen } from './role-navigation'

export function Shell() {
  const path = useRouterState({ select: s => s.location.pathname.replace(/\/$/, '') || '/app' })
  const [state, setState] = useState<D>(), [error, setError] = useState(''), [menu, setMenu] = useState(false)
  const reload = useCallback(async () => { try { setState(await api('state')); setError('') } catch (e) { setError((e as Error).message) } }, [])
  useEffect(() => { void reload() }, [reload])
  const navigate = useNavigate(), menuButton = useRef<HTMLButtonElement>(null)
  const actor = state?.actor, offer = offered(actor), current = currentEntry(path), queue = state?.overview?.queue
  const role = actor && actor.name !== ROLE_LABEL[actor.role] ? ROLE_LABEL[actor.role] : undefined
  const allowed = (destination: string) => !state || roleScreen(actor.role, destination, actor.policy?.bankAccounts != null)
  const count = (j: Job) => j.count ? countText(queue?.[j.count]) : null
  const waiting = (j: Job) => count(j) ? `${count(j)} waiting` : undefined
  useEffect(() => setMenu(false), [path])
  const closeMenu = useCallback(() => { setMenu(false); menuButton.current?.focus() }, [])
  // ⌘K (Ctrl+K elsewhere) opens Find a transaction with the caret in its one box.
  useEffect(() => {
    if (!offer.search) return
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return
      e.preventDefault(); setMenu(false)
      const box = document.querySelector<HTMLInputElement>('main input[name="q"]')
      if (path === SEARCH && box) { box.focus(); box.select() } else void navigate({ to: SEARCH })
    }
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key)
  }, [offer.search, path, navigate])
  // The bottom bar: the first four jobs, then Menu, current for every other entry but search.
  const bar = offer.jobs.slice(0, 4), inMenu = !!current && current !== SEARCH && !bar.some(j => j.to === current)
  return <div className="app">
    <HydrationUnit><header className="app-header">
      <Entry to="/app" className="brand"><img src="/brand/pantry.svg" alt="" width="28" height="28" /><span>Pantry</span></Entry>
      <nav className="app-nav" aria-label="Work">{offer.jobs.map(j => <Entry key={j.to} to={j.to} current={current === j.to} className={`nav-link${current === j.to ? ' active' : ''}`} aria-description={waiting(j)}>
        <span className="full-label">{j.tab}</span><span className="short-label">{j.short}</span>{count(j) && <span className="tally" aria-hidden="true">{count(j)}</span>}
      </Entry>)}</nav>
      <div className="app-actions">
        {offer.search && <Tip text="Find a transaction"><Entry to={SEARCH} current={current === SEARCH} className={`icon-link${current === SEARCH ? ' active' : ''}`} aria-label="Find a transaction" aria-keyshortcuts="Meta+K Control+K"><Icon name="search" /></Entry></Tip>}
        {offer.toolsPage && <Entry to={TOOLS_PAGE} current={current === TOOLS_PAGE} className={`nav-link tools-link${current === TOOLS_PAGE ? ' active' : ''}`}>Tools</Entry>}
        {offer.settings && <Tip text="Settings"><Entry to={SETTINGS} current={current === SETTINGS} className={`icon-link settings-link${current === SETTINGS ? ' active' : ''}`} aria-label="Settings"><Icon name="gear" /></Entry></Tip>}
        {actor && <OwnerMenu variant="bar" name={actor.name} role={role} />}
      </div>
    </header></HydrationUnit>
    <main className="workspace">
      {state ? <SharedState.Provider value={{ state, reload }}><>{allowed(path) ? <Outlet /> : <><h1>Access restricted</h1><p>This screen is not part of your role. Choose an available destination above.</p>{state.actor.role === 'time-only' && <Link to="/app/time">Record time</Link>}</>}</></SharedState.Provider> : <><Loading error={error} what="your books" />{error && <p><a href="/signout">Sign out or switch person</a></p>}</>}
    </main>
    {actor && <nav className="tabbar" aria-label="Work">
      {bar.map(j => <Entry key={j.to} to={j.to} current={!menu && current === j.to} className={`tabbar-link${!menu && current === j.to ? ' active' : ''}`} aria-description={waiting(j)}>
        <span className="tabbar-icon"><Icon name={j.icon} />{count(j) && <span className="tally" aria-hidden="true">{count(j)}</span>}</span><span>{j.short}</span>
      </Entry>)}
      <button ref={menuButton} type="button" className={`tabbar-link${menu || inMenu ? ' active' : ''}`} aria-expanded={menu} aria-controls={menu ? 'app-menu' : undefined} aria-current={!menu && inMenu ? 'page' : undefined} onClick={() => setMenu(m => !m)}>
        <span className="tabbar-icon"><Icon name="menu" /></span><span>Menu</span>
      </button>
    </nav>}
    {menu && actor && <AppMenu offer={offer} current={current} count={count} name={actor.name} role={role} onClose={closeMenu} />}
  </div>
}
