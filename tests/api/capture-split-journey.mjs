import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { at, harness } from './harness.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const endpoint = '/api/pantry/receipts/captures'
const regions = [
  { x: 0, y: 0, width: 0.5, height: 0.5 },
  { x: 0.5, y: 0, width: 0.5, height: 0.5 },
  { x: 0, y: 0.5, width: 1, height: 0.5 },
]

// A valid one-pixel grayscale JPEG with distinct synthetic COM metadata.
function photo(n) {
  const label = Buffer.from(`synthetic-pantry-${n}`), comment = Buffer.alloc(4)
  comment[0] = 0xff; comment[1] = 0xfe; comment.writeUInt16BE(label.length + 2, 2)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), comment, label,
    Buffer.from([0xff, 0xdb, 0, 67, 0]), Buffer.alloc(64, 1),
    Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    Buffer.from([0xff, 0xc4, 0, 20, 0, 1]), Buffer.alloc(15), Buffer.from([0]),
    Buffer.from([0xff, 0xc4, 0, 20, 0x10, 1]), Buffer.alloc(15), Buffer.from([0]),
    Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x3f, 0xff, 0xd9]),
  ])
}

async function upload(h, path, bytes, fields, { cookie = h.owner, status = 200 } = {}) {
  const form = new FormData()
  form.set('file', new Blob([bytes], { type: 'image/jpeg' }), 'synthetic-pantry-1.jpg')
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  const response = await fetch(h.origin + path, { method: 'POST', headers: { origin: h.origin, cookie }, body: form })
  const result = await response.json()
  assert.equal(response.status, status, JSON.stringify(result))
  return result
}

const source = (h, bytes, selected = regions, options) => upload(h, endpoint, bytes, { source: 'camera', regions: JSON.stringify(selected) }, options)
const part = (h, capture, index, bytes, options, revision = capture.revision) => upload(h,
  `${endpoint}/${capture.id}/parts/${index}`, bytes, { captureRevision: revision }, options)
const review = async (h, id) => at((await h.view('receipts')).review, row => row.id === id)
const retained = (state, id) => at(state.items, row => row.table === 'pt_documents' && row.id === id)
const counts = async h => (await h.db.prepare(`SELECT
  (SELECT count(*) FROM pt_capture_sources) AS sources,
  (SELECT count(*) FROM pt_capture_parts) AS parts,
  (SELECT count(*) FROM pt_receipts) AS receipts,
  (SELECT count(*) FROM pt_documents) AS documents,
  (SELECT count(*) FROM pt_audit) AS audit`).first())

async function download(h, id, expected) {
  const response = await fetch(h.origin + '/api/pantry/documents/' + id, { headers: { cookie: h.owner } })
  assert.equal(response.status, 200)
  const actual = Buffer.from(await response.arrayBuffer())
  assert.ok(actual.equals(expected), 'source and crop downloads retain exact bytes')
  assert.equal(sha(actual), sha(expected))
}

async function eraseContact(h, id) {
  const preview = await h.command('erasure.preview', { kind: 'contact', id })
  assert.deepEqual(preview.blockers, [])
  await h.command('erasure.execute', { kind: 'contact', id, fingerprint: preview.fingerprint,
    requester: 'synthetic-pantry-20', channel: 'email', reason: 'synthetic-pantry-21', confirm: 'ERASE' })
}

async function postedExpense(h, acct, vendor, date, amount) {
  const draft = await h.command('journal.save-draft', { date, memo: vendor.name, lines: [
    { accountId: acct['6100'], debit: amount, contactId: vendor.id },
    { accountId: acct['1000'], credit: amount },
  ] })
  return h.command('journal.post', { id: draft.id, revision: draft.revision })
}

async function attach(h, id, entry, vendor, amount) {
  const receipt = await review(h, id)
  return h.command('receipt.attach', { id, revision: receipt.revision, targetKind: 'journal', targetId: entry.id,
    vendor: vendor.name, date: entry.entry_date, total: amount, currency: 'USD' })
}

export async function captureSplitJourney(t) {
  const h = await harness(); t.after(() => h.close())
  const original = photo(1), crops = [photo(2), photo(3)]
  const viewer = await h.member('synthetic-pantry-4@example.test', 'viewer')
  let before = await counts(h)
  for (const options of [{ cookie: '', status: 401 }, { cookie: viewer, status: 403 }])
    await source(h, original, regions, options)
  for (const invalid of [regions.slice(0, 1), [{ ...regions[0], x: -0.1 }, regions[1]],
    [{ ...regions[0], width: 1.1 }, regions[1]], [{ ...regions[0], height: 0 }, regions[1]]])
    await source(h, original, invalid, { status: 400 })
  assert.deepEqual(await counts(h), before, 'invalid regions and unauthorized sources write nothing')

  const capture = await source(h, original)
  await download(h, capture.originalDocumentId, original)
  const stored = at((await h.view('documents')).documents, row => row.id === capture.originalDocumentId)
  assert.equal(stored.sha256, sha(original)); assert.equal(stored.size, original.length)
  assert.equal(stored.linked_kind, 'capture-source'); assert.equal(stored.linked_id, capture.id)
  before = await counts(h)
  for (const options of [{ cookie: '', status: 401 }, { cookie: viewer, status: 403 }])
    await part(h, capture, 0, crops[0], options)
  for (const index of [-1, 3, 0.5]) await part(h, capture, index, crops[0], { status: 400 })
  await part(h, capture, 0, crops[0], { status: 409 }, 'synthetic-pantry-5')
  assert.deepEqual(await counts(h), before, 'invalid indices, stale revisions and unauthorized parts write nothing')

  const children = []
  for (let index = 0; index < crops.length; index++) {
    const saved = await part(h, capture, index, crops[index])
    const receipt = await review(h, saved.id); children.push(receipt)
    assert.equal(receipt.sha256, sha(crops[index])); assert.equal(receipt.source, 'camera')
    assert.deepEqual(receipt.capture, { id: capture.id, index, region: regions[index],
      originalDocumentId: capture.originalDocumentId, originalSha256: sha(original), originalName: stored.name })
    await download(h, receipt.document_id, crops[index])
  }
  assert.notEqual(children[0].id, children[1].id)
  assert.notEqual(children[0].document_id, children[1].document_id)
  before = await counts(h)
  assert.equal((await part(h, capture, 0, photo(6))).id, children[0].id)
  await part(h, capture, 0, crops[0], { status: 409 }, 'synthetic-pantry-7')
  assert.deepEqual(await counts(h), before, 'repeated indices never publish another receipt or document')
  await download(h, children[0].document_id, crops[0])

  const reader = await h.command('integration.create', { name: 'synthetic-pantry-17', scopes: ['receipts:read'] })
  const documentsReader = await h.command('integration.create', { name: 'synthetic-pantry-18', scopes: ['documents:read'] })
  const scoped = async (path, status = 200, token = reader.token) => {
    const result = await h.send('/api/pantry/integration/v1/' + path, undefined, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(result.status, status, JSON.stringify(result.value))
    return result.value
  }
  const projected = await scoped('capture-sources/' + capture.id)
  assert.equal(projected.document_id, capture.originalDocumentId)
  assert.equal(projected.revision, capture.revision); assert.deepEqual(projected.regions, regions)
  assert.deepEqual((await scoped('capture-sources?documentId=' + capture.originalDocumentId)).records.map(row => row.id), [capture.id])
  const projectedParts = (await scoped('capture-parts?sourceId=' + capture.id)).records
  assert.equal(projectedParts.length, 2)
  for (const [index, receipt] of children.entries()) {
    const projectedPart = await scoped('capture-parts/' + receipt.id)
    assert.deepEqual(projectedPart, at(projectedParts, row => row.id === receipt.id))
    assert.equal(projectedPart.source_id, capture.id); assert.equal(projectedPart.part_index, index)
    assert.equal(projectedPart.document_id, receipt.document_id)
  }
  for (const family of ['capture-sources', 'capture-parts']) {
    assert.equal((await h.send('/api/pantry/integration/v1/' + family)).status, 401)
    await scoped(family, 403, documentsReader.token)
  }
  await scoped('documents/' + capture.originalDocumentId, 403)
  const scopedBytes = await fetch(h.origin + '/api/pantry/integration/v1/documents/' + capture.originalDocumentId,
    { headers: { authorization: `Bearer ${documentsReader.token}` } })
  assert.equal(scopedBytes.status, 200)
  assert.ok(Buffer.from(await scopedBytes.arrayBuffer()).equals(original), 'documents scope is required for exact source bytes')

  await h.command('entity.save', { legalName: 'synthetic-pantry-8', entityType: 'single-member-llc', state: 'NY',
    fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2010-01-01' })
  await h.command('chart.start', {})
  const acct = Object.fromEntries((await h.view('state')).accounts.map(row => [row.code, row.id]))
  const vendors = []
  for (const n of [9, 10]) vendors.push(await h.command('contact.save', { kind: 'vendor', name: `synthetic-pantry-${n}` }))
  const first = await postedExpense(h, acct, vendors[0], '2018-09-01', '25.00')
  await attach(h, children[0].id, first, vendors[0], '25.00')
  await eraseContact(h, vendors[0].id)
  let state = await h.view('erasure')
  assert.equal(retained(state, capture.originalDocumentId).clock, '2018-09-01')
  await download(h, capture.originalDocumentId, original)

  const second = await postedExpense(h, acct, vendors[1], '2019-09-01', '50.00')
  await attach(h, children[1].id, second, vendors[1], '50.00')
  state = await h.view('erasure')
  assert.equal(retained(state, capture.originalDocumentId).clock, '2019-09-01', 'a later posted child extends shared-source retention')
  assert.equal(retained(state, children[0].document_id).clock, '2018-09-01', 'a sibling crop keeps its own support clock')
  await h.command('journal.reverse', { id: second.id, date: '2021-09-01', memo: 'synthetic-pantry-11' })
  state = await h.view('erasure')
  assert.equal(retained(state, capture.originalDocumentId).clock, '2021-09-01', 'correction lineage extends the shared source clock')
  const protectedState = await h.command('retention.save', { years: new Date().getUTCFullYear() - 2021 + 2, revision: state.revision })
  await h.command('retention.erase', { ids: [capture.originalDocumentId], revision: protectedState.revision, confirm: 'ERASE' }, h.owner, 409)
  await download(h, capture.originalDocumentId, original)
  state = await h.command('retention.save', { years: 1, revision: protectedState.revision })
  const expired = await h.command('retention.erase', { ids: [capture.originalDocumentId], revision: state.revision, confirm: 'ERASE' })
  assert.equal(at(expired.erased, row => row.id === capture.originalDocumentId).sha256, sha(original))
  assert.equal((await h.send('/api/pantry/documents/' + capture.originalDocumentId, undefined, { cookie: h.owner })).status, 410)
  before = await counts(h)
  await part(h, capture, 2, photo(12), { status: 410 })
  assert.deepEqual(await counts(h), before, 'an erased source cannot publish its unfinished receipt')
  state = await h.view('erasure')
  await h.command('retention.save', { years: 100, revision: state.revision })
  assert.equal((await h.send('/api/pantry/documents/' + capture.originalDocumentId, undefined, { cookie: h.owner })).status, 410)
  assert.equal(at((await h.view('documents')).documents, row => row.id === capture.originalDocumentId).sha256, sha(original))

  // Unposted personal custody has no financial retention reason: erasing the
  // confirmed vendor removes its crop and the otherwise unposted source too.
  const pending = await source(h, photo(13), regions.slice(0, 2))
  const crop = await part(h, pending, 0, photo(14)), lead = await h.command('contact.save', { kind: 'vendor', name: 'synthetic-pantry-15' })
  const receipt = await review(h, crop.id)
  await h.command('receipt.vendor-confirm', { id: crop.id, revision: receipt.revision, vendorId: lead.id, vendorRevision: lead.revision, confirm: true })
  await eraseContact(h, lead.id)
  for (const id of [pending.originalDocumentId, receipt.document_id])
    assert.equal((await h.send('/api/pantry/documents/' + id, undefined, { cookie: h.owner })).status, 410)
  before = await counts(h)
  await part(h, pending, 1, photo(16), { status: 410 })
  assert.deepEqual(await counts(h), before)
}
