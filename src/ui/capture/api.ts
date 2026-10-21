import type { Region } from './images'
export type Capture = { id: string; revision: string; originalDocumentId: string }
export type ReceiptResult = { id: string; duplicate: { id: string } | null }

async function post<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch('/api/pantry/receipts/' + path, { method: 'POST', body: form })
  if (response.status === 401) { window.location.assign('/signin?returnTo=' + encodeURIComponent(window.location.pathname)); throw new Error('Sign in required') }
  const value = await response.json().catch(() => ({ error: 'The server sent an unreadable answer' })) as any
  if (!response.ok) throw new Error(value.error || 'Upload failed')
  return value as T
}
export function saveCapture(file: File, source: 'camera' | 'upload', regions: Region[]) {
  const form = new FormData()
  form.set('file', file, file.name || 'receipt-photo.jpg'); form.set('source', source); form.set('regions', JSON.stringify(regions))
  return post<Capture>('captures', form)
}
export function savePart(capture: Capture, index: number, file: File) {
  const form = new FormData()
  form.set('file', file, file.name); form.set('captureRevision', String(capture.revision))
  return post<ReceiptResult>(`captures/${encodeURIComponent(capture.id)}/parts/${index}`, form)
}
