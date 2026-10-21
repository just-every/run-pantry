// Take a photo or choose a file, and send it as it is. A photo too large for
// the model (or in a format it cannot read, like HEIC) also gets a smaller JPEG
// made here on the device; the original is still what Pantry keeps.
import { useId, useRef, useState } from 'react'
import { MAX_FILE_BYTES } from './capture/images'
import { SplitCapture } from './capture/split-capture'
import { Icon } from './icons'
import { Link } from '@tanstack/react-router'

const READABLE = /^image\/(png|jpeg|webp)$/

async function readingCopy(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/') || (READABLE.test(file.type) && file.size <= 1_500_000)) return null
  try {
    const bitmap = await createImageBitmap(file), scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const copy = await new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.85))
    bitmap.close()
    return copy
  } catch { return null }
}

export async function sendReceipt(file: File, source: 'camera' | 'upload', target?: { kind: string; id: string }) {
  if (file.size > MAX_FILE_BYTES) throw new Error('Each file must be 25 MB or smaller.')
  const form = new FormData()
  form.set('file', file, file.name || (source === 'camera' ? 'receipt-photo.jpg' : 'receipt'))
  form.set('source', source)
  const copy = await readingCopy(file)
  if (copy) form.set('copy', copy, 'reading-copy.jpg')
  if (target) { form.set('targetKind', target.kind); form.set('targetId', target.id) }
  const response = await fetch('/api/pantry/receipts/capture', { method: 'POST', body: form })
  if (response.status === 401) { window.location.assign('/signin?returnTo=' + encodeURIComponent(window.location.pathname)); throw new Error('Sign in required') }
  const value: any = await response.json().catch(() => ({ error: 'The server sent an unreadable answer' }))
  if (!response.ok) throw new Error(value.error || 'Upload failed')
  return value as { id: string; duplicate: { id: string } | null }
}

type Upload = { name: string; status: string; error?: string; duplicate?: string }
type Split = { key: number; file: File; source: 'camera' | 'upload'; finish: (message: string) => void }

/** Camera and file selection keep the original; each selected file has its own outcome. */
export function CaptureButtons({ target, onDone, compact = false }: { target?: { kind: string; id: string }; onDone: (id: string) => void | Promise<void>; compact?: boolean }) {
  const id = useId(), [busy, setBusy] = useState(false), [mode, setMode] = useState('single'), [uploads, setUploads] = useState<Upload[]>([]), [split, setSplit] = useState<Split | null>(null)
  const lock = useRef(false), splitKey = useRef(0)
  async function send(files: File[], source: 'camera' | 'upload') {
    if (!files.length || lock.current) return
    lock.current = true; setBusy(true)
    setUploads(files.map(file => ({ name: file.name, status: 'Waiting' })))
    const update = (index: number, patch: Partial<Upload>) => setUploads(current => current.map((item, i) => i === index ? { ...item, ...patch } : item))
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index]
        try {
          if (file.size > MAX_FILE_BYTES) throw new Error('Each file must be 25 MB or smaller.')
          if (!file.size) throw new Error('This file is empty. Choose a file with receipt content.')
          if (!compact && mode === 'split') {
            update(index, { status: 'Choose receipt regions' })
            const message = await new Promise<string>(finish => setSplit({ key: ++splitKey.current, file, source, finish }))
            setSplit(null); update(index, { status: message })
          } else {
            update(index, { status: source === 'camera' ? 'Reading the photo…' : 'Reading the file…' })
            const result = await sendReceipt(file, source, target)
            update(index, { status: 'Saved for review', duplicate: result.duplicate ? result.id : undefined })
            try { await onDone(result.id) } catch { update(index, { error: 'The receipt was saved. Refresh Receipts to see it.' }) }
          }
        } catch (e) { update(index, { status: 'Failed', error: (e as Error).message }) }
      }
    } finally { lock.current = false; setBusy(false) }
  }
  return <div className={`capture${compact ? ' capture-compact' : ''}`} style={{ minWidth: 0 }}>
    {!compact && <fieldset disabled={busy} style={{ width: '100%', minWidth: 0 }}><legend>Capture mode</legend>
      <label><input type="radio" name={`${id}-mode`} checked={mode === 'single'} onChange={() => setMode('single')} /> One receipt per file</label>{' '}
      <label><input type="radio" name={`${id}-mode`} checked={mode === 'split'} onChange={() => setMode('split')} /> Split receipts in a photo</label>
    </fieldset>}
    <label className={`btn ${compact ? 'btn-secondary btn-small' : 'btn-primary'}`} htmlFor={`${id}-camera`} aria-disabled={busy}><Icon name="camera" /> {compact ? 'Photo' : 'Take a photo'}</label>
    <input id={`${id}-camera`} className="sr-only" type="file" accept={mode === 'split' ? 'image/jpeg,image/png' : 'image/*'} capture="environment" disabled={busy} onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void send(files, 'camera') }} />
    <label className={`btn btn-secondary${compact ? ' btn-small' : ''}`} htmlFor={`${id}-file`} aria-disabled={busy}><Icon name="upload" /> {compact ? 'File' : 'Upload a file'}</label>
    <input id={`${id}-file`} className="sr-only" type="file" multiple accept={mode === 'split' ? 'image/jpeg,image/png' : 'image/*,application/pdf,.eml,message/rfc822'} disabled={busy} onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void send(files, 'upload') }} />
    {!compact && <div role="region" aria-label="Receipt file drop zone" aria-disabled={busy} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = busy ? 'none' : 'copy' }} onDrop={e => { e.preventDefault(); if (!busy) void send(Array.from(e.dataTransfer.files), 'upload') }} className="hint" style={{ width: '100%', padding: 12, border: '1px dashed currentColor', borderRadius: 6 }}>Drop receipt files here · up to 25 MB each. Or choose Upload a file.</div>}
    {uploads.length > 0 && <ul aria-label="File upload progress" style={{ width: '100%', minWidth: 0 }}>{uploads.map((item, index) => <li key={index} style={{ overflowWrap: 'anywhere' }}>
      <span role="status">{item.name}: {item.status}</span>
      {item.duplicate && <span className="hint"> Duplicate receipt; waiting for your choice. <Link to="/app/receipts" hash={`receipt-${item.duplicate}`}>Review duplicate</Link></span>}
      {item.error && <p role="alert" className="error">{item.error}</p>}
    </li>)}</ul>}
    {split && <SplitCapture key={split.key} file={split.file} source={split.source} onDone={onDone} onClose={split.finish} />}
  </div>
}
