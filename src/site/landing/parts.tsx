// The pieces every section is made of. Text in the drawings is real text; the
// drawings are HTML and CSS (styles/cards.css), never screenshots.
import type { ReactNode } from 'react'

/** One idea per section: eyebrow, heading and a short paragraph beside its drawing; `flip` puts the drawing first,
 * `wide` gives a long heading half the row. */
export function Feature({ id, eyebrow, title, children, art, flip = false, wide = false, label }: { id: string; eyebrow: string; title: ReactNode; children: ReactNode; art: ReactNode; flip?: boolean; wide?: boolean; label: string }) {
  return <section id={id} className={`feature${flip ? ' flip' : ''}${wide ? ' wide' : ''}`} aria-labelledby={`${id}-title`}>
    <div className="site-wrap feature-row">
      <div className="feature-copy"><p className="eyebrow">{eyebrow}</p><h2 id={`${id}-title`}>{title}</h2><p className="feature-body">{children}</p></div>
      <div className="feature-art" role="img" aria-label={label}><div aria-hidden="true" className="feature-drawing">{art}</div></div>
    </div>
  </section>
}

/** A painted plate: AVIF, then WebP, at the sizes public/site holds. */
export function Painting({ name, widths, sizes, alt = '', className, phone, eager = false }: { name: string; widths: number[]; sizes: string; alt?: string; className?: string; phone?: { name: string; widths: number[]; media: string }; eager?: boolean }) {
  const set = (n: string, ws: number[], ext: string) => ws.map(w => `/site/${n}-${w}.${ext} ${w}w`).join(', ')
  const largest = Math.max(...widths)
  return <picture className={className}>
    {phone && <source media={phone.media} type="image/avif" srcSet={set(phone.name, phone.widths, 'avif')} sizes="100vw" />}
    {phone && <source media={phone.media} type="image/webp" srcSet={set(phone.name, phone.widths, 'webp')} sizes="100vw" />}
    <source type="image/avif" srcSet={set(name, widths, 'avif')} sizes={sizes} />
    <img src={`/site/${name}-${largest}.webp`} srcSet={set(name, widths, 'webp')} sizes={sizes} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" fetchPriority={eager ? 'high' : undefined} />
  </picture>
}

export const Check = ({ className = 'check' }: { className?: string }) => <svg className={className} viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" /><path d="m7.2 12.4 3.2 3.2 6.4-6.8" /></svg>
export const Tick = () => <svg className="tick" viewBox="0 0 16 16"><path d="m3 8.5 3.2 3.2L13 4.8" /></svg>
export const Chevron = () => <svg className="chevron" viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>

const PATHS: Record<string, ReactNode> = {
  bars: <><path d="M6 19v-5M12 19V9M18 19V5" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
  swap: <><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  laptop: <><rect x="5" y="5" width="14" height="10" rx="1.5" /><path d="M3 18.5h18" /></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" /></>,
  export: <><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8" /><path d="M5 12v7.5h14V12" /></>,
  bank: <><path d="M3.5 9 12 4l8.5 5zM5 20.5h14M6.5 11v7M10 11v7M14 11v7M17.5 11v7" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  clip: <><path d="M19 11.5 12 18.5a4.6 4.6 0 0 1-6.5-6.5L13 4.5a3 3 0 0 1 4.3 4.3L10 16a1.5 1.5 0 0 1-2.1-2.1L14.5 7.4" /></>,
  receipt: <><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
}
export const Icon = ({ name, className = '' }: { name: keyof typeof PATHS | string; className?: string }) => <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24">{PATHS[name]}</svg>

/** A third party in a drawing, as a plain tinted letter tile (never its trademark). */
export const Party = ({ children, tone }: { children: ReactNode; tone: 'bank' | 'stripe' | 'gusto' | 'depot' }) => <span className={`party party-${tone}`}>{children}</span>
