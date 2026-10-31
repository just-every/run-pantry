// The one tooltip for icon-only controls (H19): the control's own accessible name, shown
// about 300 ms after hover and at once when the control takes focus other than by a press;
// Escape puts it away until the pointer or focus leaves. It never takes a tap and stays
// inside the window.
import { useRef, useState, type ReactNode } from 'react'

export function Tip({ text, children, align = 'center' }: { text: string; children: ReactNode; align?: 'center' | 'end' }) {
  const [quiet, setQuiet] = useState(false), [focused, setFocused] = useState(false), pressed = useRef(false)
  return <span className={`tip-host tip-${align}`} data-quiet={quiet || undefined} data-focused={focused || undefined}
    onPointerDown={() => { pressed.current = true }} onFocus={() => setFocused(!pressed.current)}
    onBlur={() => { pressed.current = false; setFocused(false); setQuiet(false) }}
    onKeyDown={e => { if (e.key === 'Escape') setQuiet(true) }} onMouseLeave={() => setQuiet(false)}>
    {children}<span className="tip" role="tooltip">{text}</span>
  </span>
}
