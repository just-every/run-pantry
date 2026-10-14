// The pieces every drawing is made of: the stoneware tile, the glaze tag, the
// tick and the double rule. Text in them is real text; only the material is CSS.
import type { ReactNode } from 'react'

export function Tile({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`tile ${className}`.trim()} role="img" aria-label={label}><div className="tile-face" aria-hidden="true">{children}</div></div>
}
export const Tag = ({ children, tone = 'glaze' }: { children: ReactNode; tone?: 'glaze' | 'outline' | 'dark' }) => <span className={`tag tag-${tone}`}>{children}</span>
export const Tick = () => <span className="tick" />
export const Rule = ({ children }: { children: ReactNode }) => <span className="double-rule">{children}</span>
export const Lock = () => <svg className="lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10.5" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" /><circle cx="12" cy="15.5" r="1.6" className="lock-key" /></svg>
export const DocumentGlyph = () => <svg className="doc-glyph" viewBox="0 0 48 56"><path d="M6 4h24l12 12v34a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="none" /><path d="M30 4v12h12M14 30h18M14 38h12" fill="none" /></svg>
