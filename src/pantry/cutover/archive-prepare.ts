import { must } from '../access'
import type { Context } from '../context'
import { requireThat, sha256, text, type Data } from '../core'
import { one } from '../db'
import { archiveLayout, ARCHIVE_PROVIDERS } from './archive-layouts'
import { archiveBytes, ARCHIVE_BYTES } from './archive-zip'
import { archiveSource, archiveTarget, ARCHIVE_TABLES } from './archive-sources'

export async function prepareArchive(c: Context, input: Data) {
  must(c.actor, 'owner')
  const b = await archiveLayout(input), provider = text(b.provider, 'Archive provider'), archiveKey = text(b.archiveKey, 'Export identity', 200)
  requireThat(ARCHIVE_PROVIDERS.includes(provider), 'Choose an archive provider')
  requireThat(Array.isArray(b.files) && b.files.length > 0 && b.files.length <= 100, 'Choose one to 100 original files per batch')
  const seen = new Set<string>(), mappings = new Map<string, string>(), files: Data[] = []
  let total = 0
  for (const f of b.files) {
    const sourceId = text(f.sourceId, 'Document source ID', 600)
    requireThat(!seen.has(sourceId), 'Document source IDs must be unique'); seen.add(sourceId)
    const name = text(f.name, 'Original file name', 200), mediaType = text(f.mediaType, 'File type', 100)
    requireThat(/^(application\/pdf|image\/(jpeg|png|webp)|text\/(plain|csv))$/.test(mediaType), 'Use an original PDF, supported image, text or CSV')
    const bytes = archiveBytes(f.base64)
    total += bytes.length
    requireThat(bytes.length > 0 && total <= ARCHIVE_BYTES, 'A batch holds at most 8 MB of original bytes')
    const hash = await sha256(bytes)
    requireThat(!await one(c.db, 'SELECT 1 FROM pt_documents WHERE sha256=? AND erased_at IS NOT NULL', hash), 'This original was erased after retention expiry; it cannot be imported again', 409)
    if (f.sha256) requireThat(f.sha256 === hash, 'An original does not match its expected SHA-256')
    const system = f.sourceSystem ? text(f.sourceSystem, 'Transaction source system', 100) : provider
    const transactionId = f.transactionSourceId ? text(f.transactionSourceId, 'Transaction source ID', 200) : ''
    requireThat(!f.transactionSourceId || f.transactionSourceId === transactionId, 'Transaction source ID cannot have surrounding whitespace')
    const requestedKind = f.kind ? text(f.kind, 'Transaction type') : '', targetId = f.targetId ? text(f.targetId, 'Pantry transaction ID') : ''
    requireThat(!requestedKind || Object.hasOwn(ARCHIVE_TABLES, requestedKind), 'Choose a supported transaction type')
    const resolution = await archiveSource(c, system, transactionId, requestedKind)
    if (targetId) {
      requireThat(transactionId && requestedKind, 'Confirm an original transaction source ID and record type for this mapping')
      await archiveTarget(c, requestedKind, targetId)
      requireThat(!resolution.linkedId || resolution.linkedId === targetId, 'This source ID already maps to another transaction', 409)
    }
    const linkedId = targetId || resolution.linkedId, kind = requestedKind || resolution.kind
    if (linkedId) {
      await archiveTarget(c, kind, linkedId)
      const key = JSON.stringify([system, kind, transactionId])
      requireThat(!mappings.has(key) || mappings.get(key) === linkedId, 'The batch maps the same transaction source ID to different records', 409)
      mappings.set(key, linkedId)
    }
    files.push({ sourceId, name, mediaType, bytes, sha256: hash, size: bytes.length, sourceSystem: system, transactionSourceId: transactionId, kind, linkedId,
      mappingSource: targetId ? 'owner-confirmed' : resolution.mappingSource, candidates: resolution.candidates, ...(!targetId && resolution.evidence ? { evidence: resolution.evidence } : {}), ...(f.path ? { path: f.path } : {}) })
  }
  // Resolution evidence goes into the journal; review binds the exact bytes and
  // resulting placement, so saving the same source link cannot spoil a replay.
  const summary = files.map(({ bytes, evidence, candidates, mappingSource, ...f }) => f)
  const custody = b.custody ?? null
  const fingerprint = await sha256(JSON.stringify({ provider, archiveKey, files: summary, custody }))
  return { provider, archiveKey, files, fingerprint, total, custody }
}

export const archivePreviewFiles = (files: Data[]) => files.map(({ bytes, evidence, ...f }) => f)
