// The Menu in narrower windows (B-390): Find a transaction, every job with its count, Tools,
// Settings and who is signed in. The page under it stays as it was; Escape closes it.
import { useEffect, useRef } from 'react'
import { Icon } from './icons'
import { Entry } from './entry'
import { OwnerMenu } from './owner-menu'
import { SETTINGS, TOOLS_PAGE, type Job, type offered } from './destinations'

type Row = { to: string; label: string; icon: string; count?: string | null }

export function AppMenu({ offer, current, count, name, role, onClose }: { offer: ReturnType<typeof offered>; current: string | null; count: (j: Job) => string | null | undefined; name: string; role?: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.focus()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key)
  }, [onClose])
  const row = (r: Row) => <li key={r.to}><Entry to={r.to} current={current === r.to} className="menu-row" aria-description={r.count ? `${r.count} waiting` : undefined}>
    <Icon name={r.icon} /><span>{r.label}</span>{r.count && <span className="tally" aria-hidden="true">{r.count}</span>}<Icon name="next" />
  </Entry></li>
  return <div id="app-menu" className="app-menu" ref={panel} tabIndex={-1} aria-label="Menu" role="region">
    <h2>Menu</h2>
    {offer.search && <form action="/app/search" className="menu-search" role="search"><Icon name="search" /><input name="q" type="search" aria-label="Find a transaction" placeholder="Find a transaction" maxLength={200} /></form>}
    <nav aria-label="Everything">
      <ul className="menu-list">
        {offer.jobs.map(j => row({ to: j.to, label: j.label, icon: j.icon, count: count(j) }))}
        {offer.toolsPage && row({ to: TOOLS_PAGE, label: 'Tools', icon: 'tool' })}
      </ul>
      {offer.settings && <ul className="menu-list menu-settings">{row({ to: SETTINGS, label: 'Settings', icon: 'gear' })}</ul>}
    </nav>
    <OwnerMenu variant="row" name={name} role={role} />
  </div>
}
