import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { at, harness } from './harness.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')

// Distinct text in every storage-sized part exposes missing or reordered parts.
function originalText() {
  const bytes = Buffer.alloc(25_000_000)
  for (let part = 0; part < 25; part++) {
    bytes.fill(65 + part, part * 1_000_000, (part + 1) * 1_000_000)
    bytes.write(`synthetic-pantry-1 section ${part + 1}\n`, part * 1_000_000)
  }
  return bytes
}

// A one-pixel baseline grayscale JPEG, padded with legal COM segments to the
// reading-copy boundary. No decoder or image-generation dependency is needed.
function readingJpeg() {
  const tables = Buffer.concat([
    Buffer.from([0xff, 0xdb, 0, 67, 0]), Buffer.alloc(64, 1),
    Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    Buffer.from([0xff, 0xc4, 0, 20, 0, 1]), Buffer.alloc(15), Buffer.from([0]),
    Buffer.from([0xff, 0xc4, 0, 20, 0x10, 1]), Buffer.alloc(15), Buffer.from([0]),
    Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x3f, 0xff, 0xd9]),
  ])
  const comments = []
  let remaining = 4_000_000 - tables.length - 2
  while (remaining) {
    let size = Math.min(65_537, remaining)
    if (remaining > size && remaining - size < 4) size -= 4 - (remaining - size)
    const comment = Buffer.alloc(size, 0x20)
    comment[0] = 0xff; comment[1] = 0xfe; comment.writeUInt16BE(size - 2, 2)
    comments.push(comment); remaining -= size
  }
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...comments, tables])
}

async function capture(h, bytes, { copy, cookie = h.owner, status = 200 } = {}) {
  const form = new FormData()
  form.set('source', 'upload')
  form.set('file', new Blob([bytes], { type: 'text/plain' }), 'synthetic-pantry-1.txt')
  if (copy) form.set('copy', new Blob([copy], { type: 'image/jpeg' }), 'synthetic-pantry-2.jpg')
  const response = await fetch(h.origin + '/api/pantry/receipts/capture', {
    method: 'POST', headers: { origin: h.origin, cookie }, body: form,
  })
  const result = await response.json()
  assert.equal(response.status, status, JSON.stringify(result))
  return result
}

async function download(h, id, expected) {
  const response = await fetch(h.origin + '/api/pantry/documents/' + id, { headers: { cookie: h.owner } })
  assert.equal(response.status, 200)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(bytes.length, expected.length)
  assert.ok(bytes.equals(expected), 'stored document returns its exact original bytes')
  assert.equal(sha(bytes), sha(expected), 'downloaded bytes retain their SHA-256')
}

export async function captureSizeJourney(t) {
  const h = await harness(); t.after(() => h.close())
  const original = originalText(), copy = readingJpeg(), fingerprint = sha(original)

  // Both the original alone and the largest legal reading copy fit through
  // native multipart HTTP, the real Worker and its real D1 document store.
  for (const readingCopy of [undefined, copy]) {
    const saved = await capture(h, original, { copy: readingCopy })
    const receipt = at((await h.view('receipts')).review, row => row.id === saved.id)
    assert.equal(receipt.size, original.length)
    assert.equal(receipt.sha256, fingerprint)
    await download(h, receipt.document_id, original)
    if (readingCopy) {
      assert.ok(receipt.file_document_id)
      await download(h, receipt.file_document_id, copy)
    } else assert.equal(receipt.file_document_id, null)
  }

  const before = (await h.view('receipts')).review.map(row => row.id).sort()
  await capture(h, Buffer.concat([original, Buffer.from('\n')]), { status: 413 })
  await capture(h, Buffer.from('synthetic-pantry-3'), { cookie: '', status: 401 })
  const viewer = await h.member('synthetic-pantry-4@example.test', 'viewer')
  await capture(h, Buffer.from('synthetic-pantry-5'), { cookie: viewer, status: 403 })
  assert.deepEqual((await h.view('receipts')).review.map(row => row.id).sort(), before,
    'oversized and unauthorized uploads create no receipt')
}
