// The pieces every section is made of. Text in the drawings is real text; the
// drawings are HTML and CSS (styles/sections/*.css), never screenshots.
import type { ReactNode } from 'react'

type SectionProps = { id: string; eyebrow: string; title: ReactNode; body: ReactNode; label: string; children: ReactNode; extra?: ReactNode; className?: string }

/** Heading on the left, its paragraph on the right, and the drawing across the full width below (A month in the books.). */
export function HeadSection({ id, eyebrow, title, body, label, children, className = '' }: SectionProps) {
  return <section id={id} className={`sec sec-head ${className}`.trim()} aria-labelledby={`${id}-title`}>
    <div className="site-wrap">
      <div className="sec-top"><div><p className="eyebrow">{eyebrow}</p><h2 id={`${id}-title`}>{title}</h2></div><p className="sec-body">{body}</p></div>
      <Drawing label={label}>{children}</Drawing>
    </div>
  </section>
}

/** One idea beside its drawing; `artFirst` puts the drawing on the left, as the sections alternate down the page. */
export function SideSection({ id, eyebrow, title, body, label, children, extra, className = '', artFirst = false }: SectionProps & { artFirst?: boolean }) {
  return <section id={id} className={`sec sec-side${artFirst ? ' art-first' : ''} ${className}`.trim()} aria-labelledby={`${id}-title`}>
    <div className="site-wrap sec-row">
      <div className="sec-copy"><p className="eyebrow">{eyebrow}</p><h2 id={`${id}-title`}>{title}</h2><p className="sec-body">{body}</p>{extra}</div>
      <Drawing label={label}>{children}</Drawing>
    </div>
  </section>
}

/** A drawing of the product: named once for assistive technology, its text hidden from it so nothing is read twice. */
const Drawing = ({ label, children }: { label: string; children: ReactNode }) =>
  <div className="sec-art" role="img" aria-label={label}><div className="sec-drawing" aria-hidden="true">{children}</div></div>

/** A painted plate: AVIF, then WebP, at the sizes public/site holds. */
export function Painting({ name, widths, sizes, alt = '', className, phone, eager = false }: { name: string; widths: number[]; sizes: string; alt?: string; className?: string; phone?: { name: string; widths: number[]; media: string }; eager?: boolean }) {
  const set = (n: string, ws: number[], ext: string) => ws.map(w => `/site/${n}-${w}.${ext} ${w}w`).join(', ')
  const fallback = widths.includes(1536) ? 1536 : Math.max(...widths)
  return <picture className={className}>
    {phone && <source media={phone.media} type="image/avif" srcSet={set(phone.name, phone.widths, 'avif')} sizes="100vw" />}
    {phone && <source media={phone.media} type="image/webp" srcSet={set(phone.name, phone.widths, 'webp')} sizes="100vw" />}
    <source type="image/avif" srcSet={set(name, widths, 'avif')} sizes={sizes} />
    <img src={`/site/${name}-${fallback}.webp`} srcSet={set(name, widths, 'webp')} sizes={sizes} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  </picture>
}

/** Every painted band's widths: up to 3072 so a 1920 or 2560 screen at 1x and 1.5x gets a sharp plate. */
export const BAND_WIDTHS = [768, 1152, 1536, 2304, 3072]

/** A " · " list that may wrap: a separator that would start a line is hidden, so no line begins or ends with one. */
export const Dots = ({ text, className = '' }: { text: string; className?: string }) =>
  <span className={`dots ${className}`.trim()}>{text.split(' · ').map(part => <span key={part}>{part}</span>)}</span>

export const Check = ({ className = 'check' }: { className?: string }) => <svg className={className} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" /><path d="m7.2 12.4 3.2 3.2 6.4-6.8" /></svg>
export const Chevron = () => <svg className="chevron" viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>

const PATHS: Record<string, ReactNode> = {
  bars: <><path d="M6 19v-5M12 19V9M18 19V5" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  bank: <><path d="M3.5 9 12 4l8.5 5zM5 20.5h14M6.5 11v7M10 11v7M14 11v7M17.5 11v7" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  clip: <><path d="M19 11.5 12 18.5a4.6 4.6 0 0 1-6.5-6.5L13 4.5a3 3 0 0 1 4.3 4.3L10 16a1.5 1.5 0 0 1-2.1-2.1L14.5 7.4" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  down: <><path d="m7 10 5 5 5-5" /></>,
  box: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12.2 2.4 2.4 4.8-5" /></>,
}
export const Icon = ({ name, className = '' }: { name: keyof typeof PATHS | string; className?: string }) => <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24">{PATHS[name]}</svg>

/** A third party in a drawing, as a plain tinted letter tile (never its trademark). */
export const Party = ({ children, tone }: { children: ReactNode; tone: 'bank' }) => <span className={`party party-${tone}`}>{children}</span>
