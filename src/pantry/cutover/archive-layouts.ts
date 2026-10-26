import { Buffer } from 'node:buffer'
import { Fault, requireThat, sha256, text, type Data } from '../core'
import { spreadsheetFile } from './spreadsheet-files'
import { archiveBytes, archivePath, archiveZip } from './archive-zip'

export const ARCHIVE_PROVIDERS = ['quickbooks-online', 'xero', 'freshbooks', 'hubdoc', 'dext']
const MEDIA: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv' }
const media = (name: string) => MEDIA[name.split('.').at(-1)?.toLowerCase() ?? '']
const key = (value: string) => value.toLowerCase().replace(/[ _-]/g, '')
const own = (object: Data, ...names: string[]) => {
  const found = Object.entries(object).filter(([k, value]) => names.some(n => key(n) === key(k)) && value !== '' && value !== undefined && value !== null).map(([, v]) => v)
  requireThat(found.every(v => JSON.stringify(v) === JSON.stringify(found[0])), 'Manifest columns disagree about the same identity or path')
  return found[0]
}
const kinds: Record<string, string> = { invoice: 'invoice', accrec: 'invoice', bill: 'bill', accpay: 'bill', journal: 'journal', manualjournal: 'journal', payment: 'payment', statement: 'statement', history: 'history' }
function sourceIdentity(value: unknown, label: string) {
  requireThat(typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value), `${label} must be exact text or a safe integer`)
  const id = String(value)
  requireThat(id === id.trim(), `${label} cannot have surrounding whitespace`)
  return text(id, label, 200)
}

/** Only explicit metadata identifies transactions. A path locates bytes; it is
 * never parsed as a transaction number, party name or source record ID. */
function row(value: Data, provider: string): Data {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Each manifest original needs a metadata row')
  const name = text(own(value, 'name', 'filename', 'file_name', 'original_filename') ?? own(value, 'path', 'file_path'), 'Original file name', 500)
  const path = archivePath(text(own(value, 'path', 'file_path') ?? name, 'Original path', 500))
  const sourceId = own(value, 'sourceId', 'document_id', 'attachment_id', 'id')
  const refs = value.AttachableRef
  requireThat(refs === undefined || Array.isArray(refs), 'Vendor attachment references must be an array')
  const ref = refs?.length === 1 ? refs[0]?.EntityRef : undefined
  const system = own(value, 'sourceSystem', 'source_system') ?? provider
  const transactionId = own(value, 'transactionSourceId', 'transaction_id', 'invoice_id', 'bill_id', 'txn_id') ?? ref?.value
  const rawKind = own(value, 'kind', 'transaction_type', 'record_type', 'type') ?? ref?.type
  const kind = rawKind ? kinds[String(rawKind).toLowerCase()] : ''
  requireThat(!rawKind || kind, 'Manifest transaction type is unsupported; use an explicit Pantry transaction type')
  return { sourceId: sourceId === undefined ? `zip-entry:${path}` : sourceIdentity(sourceId, 'Document source ID'), name: name.split('/').at(-1), path,
    sourceSystem: text(system, 'Transaction source system', 100), transactionSourceId: transactionId === undefined ? '' : sourceIdentity(transactionId, 'Transaction source ID'), kind,
    ...(own(value, 'targetId') ? { targetId: own(value, 'targetId') } : {}),
    ...(own(value, 'sha256') ? { sha256: own(value, 'sha256') } : {}), mediaType: own(value, 'mediaType', 'mime_type', 'content_type') ?? media(path) }
}

function readManifest(input: Data | string): Data {
  try {
    if (typeof input === 'string') { requireThat(new TextEncoder().encode(input).length <= 1_000_000, 'Archive metadata exceeds 1 MB'); return JSON.parse(input.replace(/^\uFEFF/, '')) }
    if (input && typeof input.content === 'string' && typeof input.name === 'string') {
      requireThat(new TextEncoder().encode(input.content).length <= 1_000_000, 'Archive metadata exceeds 1 MB')
      if (/\.csv$/i.test(input.name)) {
        const { sheet } = spreadsheetFile(input)
        return { files: sheet.rows.map(r => Object.fromEntries(sheet.headers.map((header, i) => [header, r.cells[i] ?? '']))) }
      }
      return JSON.parse(input.content.replace(/^\uFEFF/, ''))
    }
    requireThat(input && typeof input === 'object', 'Choose a JSON or CSV manifest')
    return input
  } catch (error) { if (error instanceof Fault) throw error; throw new Fault(400, 'The archive manifest is not valid JSON or CSV') }
}

export async function archiveLayout(b: Data): Promise<Data> {
  // Preserve the reviewed extracted-file API. ZIP and manifest uploads converge
  // on that same byte validation, review and atomic import path.
  if (!b.zip && !b.manifest) return b
  const zipBytes = b.zip ? archiveBytes(b.zip.base64) : null
  const originals = zipBytes ? archiveZip(zipBytes) : new Map<string, Uint8Array>()
  let metadataPath: string | undefined
  const candidates = [...originals.keys()].filter(path => /(?:^|\/)(?:manifest|attachments|documents)\.(?:json|csv)$/i.test(path))
  if (!b.manifest && zipBytes) {
    requireThat(candidates.length <= 1, 'This ZIP has several manifests; choose the one to review explicitly')
    metadataPath = candidates[0]
  }
  let manifestInput = b.manifest
  if (!manifestInput && metadataPath) {
    try { manifestInput = { name: metadataPath, content: new TextDecoder('utf-8', { fatal: true }).decode(originals.get(metadataPath)) } }
    catch { throw new Fault(400, 'Archive metadata must be valid UTF-8 text') }
  }
  const manifest = manifestInput ? readManifest(manifestInput) : {}
  requireThat(manifest && typeof manifest === 'object', 'The manifest needs an object or an array of original metadata rows')
  requireThat(!b.provider || !manifest.provider || b.provider === manifest.provider, 'The chosen provider differs from the manifest')
  const provider = text(manifest.provider ?? b.provider, 'Archive provider')
  requireThat(ARCHIVE_PROVIDERS.includes(provider), 'Choose an archive provider')
  requireThat(!b.archiveKey || !manifest.archiveKey || b.archiveKey === manifest.archiveKey, 'The export identity differs from the manifest')
  const archiveKey = manifest.archiveKey || b.archiveKey || (zipBytes ? `sha256:${await sha256(zipBytes)}` : '')
  const rows = Array.isArray(manifest) ? manifest : own(manifest, 'files', 'documents', 'attachments', 'Attachable') ?? []
  requireThat(Array.isArray(rows) && rows.length <= 100, 'Manifest needs at most 100 original metadata rows')
  if (!zipBytes) {
    requireThat(Array.isArray(b.files), 'Choose the extracted original files named in the manifest')
    const paths = new Set<string>()
    for (const file of b.files) {
      const path = archivePath(text(file.path ?? file.name, 'Original path', 500))
      requireThat(!paths.has(path), 'Extracted file paths must be unique'); paths.add(path)
      originals.set(path, archiveBytes(file.base64))
    }
  }
  const listed = new Set<string>(), files: Data[] = []
  for (const value of rows) {
    const f = row(value, provider)
    let path = f.path
    // Embedded manifests may name paths relative to their own directory.
    if (!originals.has(path) && metadataPath?.includes('/')) path = archivePath(metadataPath.slice(0, metadataPath.lastIndexOf('/') + 1) + path)
    requireThat(originals.has(path) && !listed.has(path), `Manifest original is missing or listed twice: ${f.path}`)
    requireThat(path !== metadataPath, 'A manifest cannot name itself as an original')
    listed.add(path); files.push({ ...f, path, base64: Buffer.from(originals.get(path)!).toString('base64') })
  }
  for (const [path, bytes] of originals) {
    if (listed.has(path) || candidates.includes(path) || path.startsWith('__MACOSX/') || /(?:^|\/)\.DS_Store$/.test(path)) continue
    requireThat(media(path), `Unsupported original in ZIP: ${path}; export PDF, supported images, text or CSV`)
    files.push({ sourceId: `zip-entry:${path}`, name: path.split('/').at(-1), path, mediaType: media(path), sourceSystem: provider, base64: Buffer.from(bytes).toString('base64') })
  }
  return { provider, archiveKey, files, custody: { ...(zipBytes ? { zipSha256: await sha256(zipBytes) } : {}), ...(manifestInput ? { manifestSha256: await sha256(JSON.stringify(manifestInput)) } : {}) } }
}
