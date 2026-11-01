// The list-plus-record frame. Above 1180 px a record opens beside its list (the list stays
// mounted as a rail); at or below it the record is its own page under a back control. It also
// holds the unknown-id and role lines and the one "Discard changes?" guard shared by every editor.
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { useBlocker, useNavigate, useRouter } from '@tanstack/react-router'
import { type RecordList } from './record-paths'

const NARROW = '(max-width: 1180px)'
const watchNarrow = (notify: () => void) => { const q = window.matchMedia(NARROW); q.addEventListener('change', notify); return () => q.removeEventListener('change', notify) }

/** True where today's two-column pages collapse: the record then stands alone, with no list. */
export function useNarrow() {
  return useSyncExternalStore(watchNarrow, () => window.matchMedia(NARROW).matches, () => false)
}

let previous: { pathname: string; searchStr: string } | undefined
/** Remember where the reader came from, so the back control can use browser Back when that was the list. */
export function useTrackPrevious() {
  const router = useRouter()
  useEffect(() => router.subscribe('onResolved', e => { if (e.hrefChanged) previous = { pathname: e.fromLocation?.pathname ?? '', searchStr: e.fromLocation?.searchStr ?? '' } }), [router])
}

const listHref = (list: RecordList) => list.to + (list.search ? '?' + new URLSearchParams(list.search) : '')

/** The "‹ <List>" control that closes the record. It goes back when the previous entry is the list, otherwise to the list. */
export function BackBar({ list }: { list: RecordList }) {
  const router = useRouter(), navigate = useNavigate()
  const go = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    const from = previous, sameTab = !list.search || new URLSearchParams(from?.searchStr).get('tab') === list.search.tab
    if (from && from.pathname === list.to && sameTab) router.history.back()
    else void navigate({ to: list.to, search: list.search })
  }
  return <a className="back-bar" href={listHref(list)} onClick={go}>{list.label}</a>
}

/** The rail beside the record at 1440; the record alone at 1180 px and below. */
export function RecordSplit({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return useNarrow() ? <>{children}</> : <div className="record-split"><aside className="record-rail" aria-label="Customers and vendors">{rail}</aside><div className="record-col">{children}</div></div>
}

/** The record column: the guard on top, then the back control, then the record itself. */
export function RecordColumn({ list, children }: { list: RecordList; children: ReactNode }) {
  return <div className="record-page"><GuardCard /><BackBar list={list} />{children}</div>
}

/** One plain body-text line for a record that is not there, with the way back. */
export function RecordLine({ text, list, children }: { text: string; list: RecordList; children?: ReactNode }) {
  const navigate = useNavigate()
  return <div className="record-line"><p>{text}</p>{children}<a href={listHref(list)} onClick={e => { e.preventDefault(); void navigate({ to: list.to, search: list.search }) }}>Back to {list.label}</a></div>
}

export const unknownRecordText = (kind: string) => `No ${kind} at this address. It may have been removed or be outside your access.`

type Guard = { blocked: boolean; markDirty: (dirty: boolean) => void; keep: () => void; discard: () => void }
const GuardContext = createContext<Guard | null>(null)

/** Holds whether an editor has typed text and blocks every way out of the page while it does. */
export function GuardProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false), opener = useRef<Element | null>(null)
  const blocker = useBlocker({ shouldBlockFn: () => dirty.current, withResolver: true, enableBeforeUnload: false })
  const blocked = blocker.status === 'blocked'
  useEffect(() => { if (blocked) opener.current = document.activeElement }, [blocked])
  const guard: Guard = {
    blocked, markDirty: d => { dirty.current = d },
    keep: () => { blocker.reset?.(); const el = opener.current; if (el instanceof HTMLElement && el.isConnected) el.focus() },
    discard: () => { dirty.current = false; blocker.proceed?.() },
  }
  return <GuardContext.Provider value={guard}>{children}</GuardContext.Provider>
}

export const useGuard = () => useContext(GuardContext)

/** An editor reports whether it holds changes the reader has not saved. */
export function useGuardDirty(dirty: boolean) {
  const guard = useContext(GuardContext)
  useEffect(() => { guard?.markDirty(dirty); return () => guard?.markDirty(false) }, [dirty])
}

/** The one in-page "Discard changes?" card, never a browser dialog. Keep editing takes focus when it appears. */
export function GuardCard() {
  const guard = useContext(GuardContext), keep = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (guard?.blocked) keep.current?.focus() }, [guard?.blocked])
  if (!guard?.blocked) return null
  return <section className="guard-card" role="alertdialog" aria-labelledby="guard-title">
    <h2 id="guard-title">Discard changes?</h2>
    <div className="guard-actions"><button ref={keep} type="button" className="btn btn-primary" onClick={guard.keep}>Keep editing</button><button type="button" className="btn btn-secondary" onClick={guard.discard}>Discard</button></div>
  </section>
}
