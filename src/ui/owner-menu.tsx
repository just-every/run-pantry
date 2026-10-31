// Who is signed in, as a button that opens a small menu holding Sign out or switch person
// (CR24). A native button opens it on Enter or Space; Escape closes it and returns focus to
// the button. Its state lives here, so a refresh of the books never closes it.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { Tip } from './tip'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'

/** `bar`: the avatar and name in the top bar (narrower windows show the avatar alone). `row`: the Menu's last row. */
export function OwnerMenu({ name, role, variant }: { name: string; role?: string; variant: 'bar' | 'row' }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); button.current?.focus() } }
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away)
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away) }
  }, [open])
  const avatar = <span className="avatar" aria-hidden="true">{initials(name)}</span>
  const toggle = <button ref={button} type="button" className="owner-button" aria-haspopup="menu" aria-expanded={open} aria-label={variant === 'bar' ? name : undefined} onClick={() => setOpen(o => !o)}>
    {avatar}
    {variant === 'bar' ? <><span className="owner-name">{name}</span><Icon name="down" /></>
      : <><span className="owner-text"><strong>{name}{role && <span> · {role}</span>}</strong><small>Sign out or switch person</small></span><Icon name="next" /></>}
  </button>
  return <div className={`owner owner-${variant}`} ref={box}>
    {variant === 'bar' ? <Tip text={name} align="end">{toggle}</Tip> : toggle}
    {open && <div className="owner-menu">
      {variant === 'bar' && <p className="owner-who">{name}{role && <small>{role}</small>}</p>}
      <div role="menu" aria-label={name}><form method="post" action="/signout" role="none"><button type="submit" role="menuitem" className="owner-item">Sign out or switch person</button></form></div>
    </div>}
  </div>
}
