// Shared screen pieces: API calls, money, status chips, forms and tables that
// stack into label/value blocks on a phone.
import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { Icon } from './icons'

export type D = Record<string, any>

export async function api(path: string, body?: D) {
  const response = await fetch('/api/pantry/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const value: any = await response.json().catch(() => ({ error: 'The server sent an unreadable answer' }))
  if (response.status === 401) { window.location.assign('/signin?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search)); throw new Error('Sign in required') }
  if (!response.ok) throw new Error(value.error || 'Request failed')
  return value
}

export const command = (op: string, body: D) => api('command/' + op, body)

/** Load a view; `reload` refetches after a change. What it returns always belongs to the current
 * path: while a new path loads (a report tab, a record) there is no data, never the previous path's,
 * and an answer for a path no longer shown is dropped. */
export function useView<T = D>(path: string | null) {
  const [view, setView] = useState<{ path: string; data?: T; error: string }>(), current = useRef(path)
  current.current = path
  const reload = useCallback(async () => {
    if (!path) return
    try { const data = await api(path); if (current.current === path) setView({ path, data, error: '' }) }
    catch (e) { if (current.current === path) setView(v => ({ path, data: v?.path === path ? v.data : undefined, error: (e as Error).message })) }
  }, [path])
  useEffect(() => { void reload() }, [reload])
  const mine = view?.path === path ? view : undefined
  return { data: mine?.data, error: mine?.error ?? '', reload }
}

export type Shared = { state: D; reload: () => Promise<void> }
export const SharedState = createContext<Shared | null>(null)
export const useShared = () => useContext(SharedState)!

/** The name to show where a person or agent acted; the email only when no name is known. */
export function useWho() {
  const names: Record<string, string> = useShared().state.names
  return (email?: string | null) => email ? names[email.toLowerCase()] ?? email : '—'
}

export function usd(c: number | null | undefined) {
  if (c === null || c === undefined) return '—'
  const sign = c < 0 ? '−' : '', abs = Math.abs(c)
  return `${sign}$${Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(abs % 100).padStart(2, '0')}`
}
export const amountText = (c: number) => (c / 100).toFixed(2)
/** Today on this computer's calendar, as YYYY-MM-DD. */
export const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
export const thisMonth = () => today().slice(0, 7)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function day(iso?: string | null) {
  if (!iso) return '—'
  // A timestamp is shown on this computer's calendar; a plain date is already a calendar day.
  const at = iso.length > 10 ? new Date(iso) : null
  const [y, m, d] = at ? [at.getFullYear(), at.getMonth() + 1, at.getDate()] : iso.split('-').map(Number)
  return <time dateTime={iso}>{`${MONTHS[m - 1]} ${d}, ${y}`}</time>
}
export function monthName(period: string) {
  const [y, m] = period.split('-').map(Number)
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`
}

export function Chip({ tone = 'neutral', children }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'agent' | 'neutral'; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

export function PageHead({ title, lead, actions, chip }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; chip?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}{chip && <> {chip}</>}</h1>{lead && <p className="lead">{lead}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`card ${className}`.trim()}>{(title || actions) && <div className="card-head">{title && <h2>{title}</h2>}{actions && <div className="card-actions">{actions}</div>}</div>}<div className="card-body">{children}</div></section>
}

/** Figure tiles; an `icon` puts a tinted disc beside the label (green for a good tone, apricot for a bad one). */
export function Metrics({ items }: { items: { label: string; value: ReactNode; note?: ReactNode; tone?: string; icon?: string }[] }) {
  return <div className="metrics">{items.map(m => <div className={`metric${m.icon ? ' with-icon' : ''}`} key={m.label}>{m.icon && <span className={`metric-icon${m.tone ? ` tone-${m.tone}` : ''}`}><Icon name={m.icon} /></span>}<p>{m.label}</p><strong className={m.tone ? `tone-${m.tone}` : ''}>{m.value}</strong>{m.note && <small>{m.note}</small>}</div>)}</div>
}

function labelled(row: ReactNode, heads: string[]): ReactNode {
  if (!isValidElement(row)) return row
  const element = row as ReactElement<{ children?: ReactNode }>
  return cloneElement(element, {}, Children.toArray(element.props.children).map((cell, i) => isValidElement(cell) ? cloneElement(cell as ReactElement<D>, { 'data-label': heads[i] || undefined }) : cell))
}

/** The empty state: a small stack of blank ledger lines in the mark's colours over the sentence. */
export function Empty({ children }: { children: ReactNode }) {
  return <><span className="empty-lines" aria-hidden="true" />{children}</>
}

/** A ruled table. Numeric columns are named in `figures` and right-align. */
export function Table({ heads, figures = [], children, empty, caption }: { heads: string[]; figures?: number[]; children: ReactNode; empty?: ReactNode; caption?: string }) {
  const rows = Children.toArray(children)
  return <div className="table-wrap"><table className="ledger">{caption && <caption className="sr-only">{caption}</caption>}<thead><tr>{heads.map((h, i) => <th key={i} scope="col" className={figures.includes(i) ? 'fig' : undefined}>{h}</th>)}</tr></thead>
    <tbody>{rows.length ? rows.map(r => labelled(r, heads)) : <tr className="empty"><td colSpan={heads.length}><Empty>{empty ?? 'Nothing here yet.'}</Empty></td></tr>}</tbody></table></div>
}

export function Field({ label, name, type = 'text', defaultValue, required = false, options, hint, error, wide, empty = 'Choose…', ...rest }: {
  label: string; name: string; type?: string; defaultValue?: any; required?: boolean; options?: { value: string; label: string }[]; hint?: ReactNode; error?: string; wide?: boolean; empty?: string; [k: string]: any
}) {
  const id = useId(), initial = 'value' in rest ? {} : { defaultValue: defaultValue ?? (options ? '' : undefined) }
  const control = options
    ? <select id={id} name={name} {...initial} required={required} aria-invalid={error ? true : undefined} {...rest}><option value="">{empty}</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    : type === 'textarea' ? <textarea id={id} name={name} {...initial} required={required} {...rest} />
    : <input id={id} name={name} type={type} {...initial} required={required} aria-invalid={error ? true : undefined} {...rest} />
  return <div className={`field${wide ? ' field-wide' : ''}`}><label htmlFor={id}>{label}</label>{control}{hint && <small className="hint">{hint}</small>}{error && <small className="error">{error}</small>}</div>
}

/** A single app-styled file field; the native input keeps picker, labels and validation. */
export function FileInput({ onChange, ...props }: ComponentProps<'input'>) {
  const [names, setNames] = useState('')
  return <div className="file-field">
    <input {...props} type="file" onChange={event => { setNames(Array.from(event.currentTarget.files ?? []).map(file => file.name).join(', ')); onChange?.(event) }} />
    <span className="file-prompt" aria-hidden="true">Choose a file</span>
    <span className="file-name" aria-hidden="true">{names || 'No file selected'}</span>
  </div>
}

/** A form that sends its fields (plus `extra`) and shows the server's refusal beside its action. */
export function Form({ children, submit, label, onDone, extra, className = '', secondary }: { children: ReactNode; submit: (body: D) => Promise<any>; label: string; onDone?: (result: any) => void | Promise<void>; extra?: () => D; className?: string; secondary?: ReactNode }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget
    setBusy(true); setError('')
    try { const result = await submit({ ...Object.fromEntries(new FormData(form)), ...(extra?.() ?? {}) }); await onDone?.(result) }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>{className ? <div className={className}>{children}</div> : children}<div className="form-end"><button className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : label}</button>{secondary}{error && <p role="alert" className="error">{error}</p>}</div></form>
}

/** A button that runs one action and reports its refusal in place. */
export function Action({ run, children, tone = 'secondary', disabled, title }: { run: () => Promise<any>; children: ReactNode; tone?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; title?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <span className="action"><button type="button" title={title} className={`btn btn-${tone}`} disabled={busy || disabled} onClick={async () => { setBusy(true); setError(''); try { await run() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>{busy ? 'Working…' : children}</button>{error && <span role="alert" className="error">{error}</span>}</span>
}

/** Keyboard-operable disclosure for secondary facts. A fact given as `code` shows on one line in monospace, scrolling sideways when long. */
export function Details({ facts, code = [] }: { facts: D; code?: string[] }) {
  return <details className="details"><summary>Details</summary><dl>{Object.entries(facts).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={code.includes(k) ? 'code' : undefined}>{v === null || v === undefined ? '—' : String(v)}</dd></div>)}</dl></details>
}

/** Tabs wrap onto a second row on a phone. With `pick`, a phone shows a select with that label instead. */
export function Tabs({ tabs, current, onChange, pick, revealCurrent = false }: { tabs: string[]; current: string; onChange: (t: string) => void; pick?: string; revealCurrent?: boolean }) {
  const id = useId(), strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = strip.current, active = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!revealCurrent || !list || !active) return
    const outer = list.getBoundingClientRect(), inner = active.getBoundingClientRect()
    if (inner.left < outer.left) list.scrollLeft += inner.left - outer.left
    else if (inner.right > outer.right) list.scrollLeft += inner.right - outer.right
  }, [current, revealCurrent])
  return <>
    <div ref={strip} className={`tabs${pick ? ' tabs-pickable' : ''}`} role="tablist">{tabs.map(t => <button key={t} type="button" role="tab" aria-selected={current === t} className={current === t ? 'active' : ''} onClick={() => onChange(t)}>{t}</button>)}</div>
    {pick && <div className="field tabs-pick"><label htmlFor={id}>{pick}</label><select id={id} value={current} onChange={e => onChange(e.target.value)}>{tabs.map(t => <option key={t} value={t}>{t}</option>)}</select></div>}
  </>
}

export function Loading({ error, what }: { error?: string; what: string }) {
  return error ? <p role="alert" className="error">{error}</p> : <p className="lead">Opening {what}…</p>
}

export const accountOptions = (accounts: D[], filter: (a: D) => boolean = () => true) => accounts.filter(a => a.active && filter(a)).map(a => ({ value: a.id, label: `${a.code} · ${a.name}` }))
export const contactOptions = (contacts: D[], kind: string) => contacts.filter(c => c.kind === kind && c.active).map(c => ({ value: c.id, label: c.name }))

export async function readFileText(input: HTMLInputElement | null) {
  const file = input?.files?.[0]
  if (!file) throw new Error('Choose a file')
  return { name: file.name, content: await file.text() }
}

export async function readFileBase64(input: HTMLInputElement | null) {
  const file = input?.files?.[0]
  if (!file) throw new Error('Choose a file')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { name: file.name, mediaType: file.type || 'application/octet-stream', base64: btoa(binary) }
}

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', bookkeeper: 'Bookkeeper', accountant: 'Accountant', viewer: 'Viewer', sales: 'Sales', 'payables-clerk': 'Payables clerk', 'time-only': 'Time tracking only' }

/** A reserved address no mail reaches, such as the owner@run-pantry.test a first `rer dev` sets up with. */
export const placeholderEmail = (email: string | null | undefined) => !email || /@(?:[^@]*\.)?(?:test|localhost|invalid|example|example\.(?:com|net|org))$/i.test(email)

/** The image types a browser shows inline from Pantry's document route (`?view=1`). */
export const IMAGE_TYPE = /^image\/(png|jpeg|webp|gif)$/

/** A stored file by name, led by a small picture of it when it is a photo. */
export function FileLink({ id, name, mediaType }: { id: string; name: string; mediaType?: string | null }) {
  const shared = useContext(SharedState), policy = shared?.state.actor.policy
  if (policy?.maskTin || policy?.maskBank) return <span>{name} · original restricted</span>
  return <a className="file-link" href={`/api/pantry/documents/${id}`}>{mediaType && IMAGE_TYPE.test(mediaType) && <img className="file-thumb" src={`/api/pantry/documents/${id}?view=1`} alt="" loading="lazy" />}<span>{name}</span></a>
}
