// Take a photo or choose a file, and send it as it is. A photo too large for
// the model (or in a format it cannot read, like HEIC) also gets a smaller JPEG
// made here on the device; the original is still what Pantry keeps.
import { useId, useState } from 'react'
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
    return await new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.85))
  } catch { return null }
}

export async function sendReceipt(file: File, source: 'camera' | 'upload', target?: { kind: string; id: string }) {
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

/** "Take a photo" opens the phone's camera; "Upload a file" takes a photo, PDF or saved email.
 * Compact (one per row in a list) both are white secondaries, so the page keeps its one navy action. */
export function CaptureButtons({ target, onDone, compact = false }: { target?: { kind: string; id: string }; onDone: (id: string) => void | Promise<void>; compact?: boolean }) {
  const id = useId(), [busy, setBusy] = useState(''), [error, setError] = useState(''), [duplicate, setDuplicate] = useState('')
  async function send(file: File | undefined, source: 'camera' | 'upload', input: HTMLInputElement) {
    if (!file) return
    setBusy(source === 'camera' ? 'Reading the photo…' : 'Reading the file…'); setError(''); setDuplicate('')
    try { const r = await sendReceipt(file, source, target); if (r.duplicate) setDuplicate(r.id); await onDone(r.id) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(''); input.value = '' }
  }
  return <div className={`capture${compact ? ' capture-compact' : ''}`}>
    <label className={`btn ${compact ? 'btn-secondary btn-small' : 'btn-primary'}`} htmlFor={`${id}-camera`} aria-disabled={!!busy}><Icon name="camera" /> {compact ? 'Photo' : 'Take a photo'}</label>
    <input id={`${id}-camera`} className="sr-only" type="file" accept="image/*" capture="environment" disabled={!!busy} onChange={e => send(e.currentTarget.files?.[0], 'camera', e.currentTarget)} />
    <label className={`btn btn-secondary${compact ? ' btn-small' : ''}`} htmlFor={`${id}-file`} aria-disabled={!!busy}><Icon name="upload" /> {compact ? 'File' : 'Upload a file'}</label>
    <input id={`${id}-file`} className="sr-only" type="file" accept="image/*,application/pdf,.eml,message/rfc822" disabled={!!busy} onChange={e => send(e.currentTarget.files?.[0], 'upload', e.currentTarget)} />
    {busy && <span role="status" className="hint">{busy}</span>}
    {duplicate && <span role="status" className="hint">Duplicate receipt; waiting for your choice. <Link to="/app/receipts" hash={`receipt-${duplicate}`}>Review duplicate</Link></span>}
    {error && <span role="alert" className="error">{error}</span>}
  </div>
}
