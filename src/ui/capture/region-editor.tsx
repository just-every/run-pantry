import { useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { Field } from '../kit'
import { MAX_REGIONS, type Region, validRegion } from './images'

const percent = (value: number) => Math.round(value * 10000) / 100
const rectangle = (a: {x: number; y: number}, b: {x: number; y: number}): Region => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) })

export function RegionEditor({ url, regions, onChange, disabled }: { url: string; regions: Region[]; onChange: (regions: Region[]) => void; disabled: boolean }) {
  const start = useRef<{ x: number; y: number } | null>(null), [draft, setDraft] = useState<Region | null>(null)
  function point(e: PointerEvent<HTMLDivElement>) {
    const bounds = e.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height)) }
  }
  return <div style={{ width: '100%', minWidth: 0 }}>
    <p className="hint" id="capture-region-help">Draw a rectangle around each receipt, or add a region and enter percentages below. Choose at least two. You choose every region; no automatic detection is used.</p>
    <div role="group" aria-label="Receipt photo region editor" aria-describedby="capture-region-help" style={{ position: 'relative', width: '100%', maxWidth: 720, touchAction: 'none', lineHeight: 0, cursor: disabled ? 'default' : 'crosshair' }}
      onPointerDown={e => { if (disabled || regions.length >= MAX_REGIONS || (e.pointerType === 'mouse' && e.button !== 0)) return; e.preventDefault(); start.current = point(e); setDraft(rectangle(start.current, start.current)); e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={e => { if (start.current) setDraft(rectangle(start.current, point(e))) }}
      onPointerUp={e => { if (!start.current) return; const next = rectangle(start.current, point(e)); start.current = null; setDraft(null); if (next.width >= 0.005 && next.height >= 0.005) onChange([...regions, next]); e.currentTarget.releasePointerCapture(e.pointerId) }}
      onPointerCancel={() => { start.current = null; setDraft(null) }}>
      <img src={url} alt="Original photo for choosing separate receipt regions" draggable={false} style={{ display: 'block', width: '100%', height: 'auto' }} />
      {[...regions, ...(draft ? [draft] : [])].map((r, i) => <span key={i} aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none', boxSizing: 'border-box', border: '2px solid #223a5e', background: 'rgba(100,160,210,.13)', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }}><b style={{ background: '#223a5e', color: '#fff', fontSize: 14, lineHeight: '24px', padding: '2px 6px' }}>{i + 1}</b></span>)}
    </div>
    {regions.map((r, index) => <fieldset key={index} disabled={disabled} style={{ minWidth: 0, marginTop: 16 }}>
      <legend>Receipt {index + 1} region</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {(['x', 'y', 'width', 'height'] as const).map(key => <Field key={key} label={`Receipt ${index + 1} ${key === 'x' ? 'left' : key === 'y' ? 'top' : key} (%)`} name={`region-${index}-${key}`} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={percent(r[key])} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(regions.map((item, i) => i === index ? { ...item, [key]: Number(e.target.value) / 100 } : item))} />)}
      </div>
      {!validRegion(r) && <p className="hint">Enter a width and height above zero and keep this region within the photo.</p>}
      <button type="button" className="btn btn-secondary btn-small" onClick={() => onChange(regions.filter((_, i) => i !== index))}>Remove receipt {index + 1} region</button>
    </fieldset>)}
    <p><button type="button" className="btn btn-secondary btn-small" disabled={disabled || regions.length >= MAX_REGIONS} onClick={() => onChange([...regions, { x: 0, y: 0, width: 0, height: 0 }])}>Add receipt region</button></p>
  </div>
}
