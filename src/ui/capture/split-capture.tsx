import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { saveCapture, savePart, type Capture } from './api'
import { crop, photo, validRegion, type Region } from './images'
import { RegionEditor } from './region-editor'

type Part = { file: File; status: 'waiting' | 'saving' | 'saved' | 'failed'; error?: string; id?: string; duplicate?: boolean }

/** The original is saved once. A failed crop keeps its index and is retried only by its button. */
export function SplitCapture({ file, source, onDone, onClose }: { file: File; source: 'camera' | 'upload'; onDone: (id: string) => void | Promise<void>; onClose: (message: string) => void }) {
  const [preview, setPreview] = useState(''), [regions, setRegions] = useState<Region[]>([]), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [capture, setCapture] = useState<Capture | null>(null), [parts, setParts] = useState<Part[]>([])
  const bitmap = useRef<ImageBitmap | null>(null), original = useRef<Capture | null>(null), lock = useRef(false)
  useEffect(() => {
    let live = true
    const url = URL.createObjectURL(file)
    void photo(file).then(value => { if (live) { bitmap.current = value; setPreview(url) } else value.close() }).catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false; URL.revokeObjectURL(url); bitmap.current?.close(); bitmap.current = null }
  }, [file])
  function update(index: number, patch: Partial<Part>) { setParts(current => current.map((part, i) => i === index ? { ...part, ...patch } : part)) }
  async function uploadPart(session: Capture, part: Part, index: number) {
    update(index, { status: 'saving', error: '' })
    try {
      const result = await savePart(session, index, part.file)
      update(index, { status: 'saved', id: result.id, duplicate: !!result.duplicate })
      try { await onDone(result.id) } catch { setError('The receipt was saved. Refresh Receipts to see it.') }
    } catch (e) { update(index, { status: 'failed', error: (e as Error).message }) }
  }
  async function save() {
    if (lock.current || !bitmap.current || regions.length < 2 || !regions.every(validRegion)) return
    lock.current = true; setBusy(true); setError('')
    try {
      // Prepare every actual crop before retaining an original or creating any receipt.
      const prepared: Part[] = []
      for (let i = 0; i < regions.length; i++) prepared.push({ file: await crop(bitmap.current, regions[i], file.name, i), status: 'waiting' })
      const session = original.current ?? await saveCapture(file, source, regions)
      original.current = session; setCapture(session); setParts(prepared)
      for (let i = 0; i < prepared.length; i++) await uploadPart(session, prepared[i], i)
    } catch (e) { setError((e as Error).message) }
    finally { lock.current = false; setBusy(false) }
  }
  async function retry(index: number) {
    if (lock.current || !capture || parts[index].status !== 'failed') return
    lock.current = true; setBusy(true)
    try { await uploadPart(capture, parts[index], index) } finally { lock.current = false; setBusy(false) }
  }
  const saved = parts.filter(p => p.status === 'saved').length, complete = parts.length > 0 && saved === parts.length
  return <section aria-label={`Split ${file.name}`} style={{ width: '100%', minWidth: 0 }}>
    <h3>Split receipts in a photo</h3><p style={{ overflowWrap: 'anywhere' }}>{file.name}</p>
    {preview && <RegionEditor url={preview} regions={regions} onChange={setRegions} disabled={busy || !!capture} />}
    <p className="hint">Each region becomes a separate JPEG receipt for review. Pantry keeps your original photo unchanged. Nothing is posted to your books.</p>
    {capture && <p role="status">Original photo saved. <a href={`/api/pantry/documents/${capture.originalDocumentId}`}>Download original capture</a></p>}
    {parts.length > 0 && <ol aria-label="Separate receipt progress">{parts.map((p, index) => <li key={index} style={{ overflowWrap: 'anywhere' }}>
      <span role="status">Receipt {index + 1}: {p.status === 'saved' ? (p.duplicate ? 'Saved · duplicate receipt; waiting for your choice.' : 'Saved for review') : p.status === 'saving' ? 'Saving…' : p.status === 'failed' ? 'Failed' : 'Waiting'}</span>
      {p.id && <> <Link to="/app/receipts" hash={`receipt-${p.id}`}>{p.duplicate ? 'Review duplicate' : `Review receipt ${index + 1}`}</Link></>}
      {p.error && <p role="alert" className="error">{p.error}</p>}
      {p.status === 'failed' && <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => retry(index)}>Retry receipt {index + 1}</button>}
    </li>)}</ol>}
    {busy && <p role="status" className="hint">{capture ? `Saving separate receipts… ${saved} of ${regions.length} saved` : 'Preparing receipt crops and saving original photo…'}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="form-end">
      {!capture && preview && <button type="button" className="btn btn-primary" disabled={busy || regions.length < 2 || !regions.every(validRegion)} onClick={save}>Save {regions.length} separate receipts</button>}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onClose(complete ? `${saved} separate receipts saved for review` : capture ? `${saved} of ${parts.length} separate receipts saved; original photo retained` : 'Split cancelled; no receipt saved')}>{complete ? 'Done splitting' : capture ? 'Keep saved receipts and close' : 'Cancel split'}</button>
    </div>
  </section>
}
