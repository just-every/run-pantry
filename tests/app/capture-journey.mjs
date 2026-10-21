import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'
import { receiptPhoto, threePagePdf } from './capture-fixtures.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const dir = '/tmp/sx-pantry-c29-capture'
const headersFor = origin => ({ origin })

async function drop(page, file) {
  const transfer = await page.evaluateHandle(({ name, mimeType, bytes }) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType })); return data
  }, { ...file, bytes: Array.from(file.buffer) })
  try { await page.getByRole('region', { name: 'Receipt file drop zone' }).dispatchEvent('drop', { dataTransfer: transfer }) }
  finally { await transfer.dispose() }
}
async function unchanged(request, origin, documentId, expected) {
  const response = await request.get(`${origin}/api/pantry/documents/${documentId}`)
  assert.equal(response.status(), 200)
  const actual = await response.body()
  assert.equal(digest(actual), digest(expected)); assert.deepEqual(actual, expected)
}

/** Real emitted Worker, native owner bootstrap, real uploads and persisted/downloaded evidence. */
export async function captureJourney(t) {
  await mkdir(dir, { recursive: true })
  const heic = await readFile(new URL('../../fixtures/capture/synthetic-pantry-2.heic', import.meta.url))
  assert.equal(heic.toString('ascii', 4, 8), 'ftyp', 'the fixture is a genuine HEIF container')
  assert.match(heic.toString('ascii', 8, 32), /heic|heix|mif1/)
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext(); t.after(() => owner.close())
  const origin = app.origin, headers = headersFor(origin)
  assert.equal((await owner.request.post(`${origin}/auth/bootstrap`, { headers, data: { token: TOKEN, displayName: 'Olivia Owner' }, maxRedirects: 0 })).status(), 303)
  assert.equal((await owner.request.post(`${origin}/setup`, { headers, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
  const command = async (operation, data) => {
    const response = await owner.request.post(`${origin}/api/pantry/command/${operation}`, { headers, data })
    assert.equal(response.status(), 200, await response.text()); return response.json()
  }
  await command('entity.save', { legalName: 'Cedar Studio LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: '' })
  await command('chart.start', {})
  const initialBooks = await (await owner.request.get(`${origin}/api/pantry/journal`)).json()
  const signedIn = await owner.storageState()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    try {
      const page = await context.newPage(), errors = [], base = width === 1440 ? 1 : 4
      page.on('pageerror', e => errors.push(String(e)))
      await page.goto(`${origin}/app/receipts`)
      await page.getByRole('radio', { name: 'Split receipts in a photo', exact: true }).waitFor()
      await page.screenshot({ path: `${dir}/capture-mode-${width}.png`, fullPage: true })
      const image = { name: `synthetic-pantry-${base}.png`, mimeType: 'image/png', buffer: await receiptPhoto(page, base) }
      await page.getByRole('radio', { name: 'Split receipts in a photo', exact: true }).check()
      // File selection is explicitly split only after the owner chooses that mode.
      await page.getByLabel('Upload a file', { exact: true }).setInputFiles(image)
      await page.getByAltText('Original photo for choosing separate receipt regions').waitFor()
      assert.equal(await page.getByRole('button', { name: 'Save 0 separate receipts' }).isDisabled(), true)
      await page.screenshot({ path: `${dir}/capture-empty-editor-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Cancel split', exact: true }).click()
      if (width === 1440) await drop(page, image)
      else await page.getByLabel('Take a photo', { exact: true }).setInputFiles(image)
      const editor = page.getByRole('group', { name: 'Receipt photo region editor' })
      await editor.waitFor()
      await editor.locator('img').evaluate(image => image.decode())
      await editor.scrollIntoViewIfNeeded()
      // Pointer selection on desktop; the same photo has fully accessible numeric selection on phone.
      if (width === 1440) {
        const bounds = await editor.boundingBox(); assert.ok(bounds)
        await page.mouse.move(bounds.x + bounds.width * .07, bounds.y + bounds.height * .0556)
        assert.ok(bounds.height > 100)
        await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .45, bounds.y + bounds.height * .9333); await page.mouse.up()
        await page.getByLabel('Receipt 1 left (%)', { exact: true }).waitFor()
      } else await page.getByRole('button', { name: 'Add receipt region', exact: true }).click()
      if (width === 390) for (const [field, value] of [['left', '7'], ['top', '5.56'], ['width', '38'], ['height', '87.77']]) await page.getByLabel(`Receipt 1 ${field} (%)`, { exact: true }).fill(value)
      await page.getByRole('button', { name: 'Add receipt region', exact: true }).click()
      for (const [field, value] of [['left', '55'], ['top', '5.56'], ['width', '38'], ['height', '87.77']]) await page.getByLabel(`Receipt 2 ${field} (%)`, { exact: true }).fill(value)
      await page.screenshot({ path: `${dir}/capture-regions-${width}.png`, fullPage: true })
      // A dropped network connection must leave the first receipt and the original intact.
      let failures = 0
      const failPart = async route => { if (failures++ === 0) await route.abort('failed'); else await route.continue() }
      await page.route('**/api/pantry/receipts/captures/*/parts/1', failPart)
      const creation = page.waitForResponse(response => response.url() === `${origin}/api/pantry/receipts/captures` && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Save 2 separate receipts', exact: true }).click()
      const creationResponse = await creation; assert.equal(creationResponse.status(), 200)
      const capture = await creationResponse.json()
      await page.getByRole('button', { name: 'Retry receipt 2', exact: true }).waitFor()
      await page.getByText('Receipt 1: Saved for review', { exact: true }).waitFor()
      await unchanged(context.request, origin, capture.originalDocumentId, image.buffer)
      await page.screenshot({ path: `${dir}/capture-partial-${width}.png`, fullPage: true })
      const afterFailure = await (await context.request.get(`${origin}/api/pantry/receipts`)).json()
      assert.equal(afterFailure.review.filter(r => r.capture?.id === capture.id).length, 1)
      await page.unroute('**/api/pantry/receipts/captures/*/parts/1', failPart)
      await page.getByRole('button', { name: 'Retry receipt 2', exact: true }).click()
      await page.getByRole('button', { name: 'Done splitting', exact: true }).waitFor()
      await page.screenshot({ path: `${dir}/capture-saved-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Done splitting', exact: true }).click()
      const split = (await (await context.request.get(`${origin}/api/pantry/receipts`)).json()).review.filter(r => r.capture?.id === capture.id).sort((a, b) => a.capture.index - b.capture.index)
      assert.equal(split.length, 2); assert.deepEqual(split.map(r => r.capture.index), [0, 1])
      const cropBodies = []
      for (const [index, receipt] of split.entries()) {
        assert.equal(receipt.capture.originalDocumentId, capture.originalDocumentId)
        assert.equal(receipt.capture.originalSha256, digest(image.buffer))
        assert.equal(receipt.capture.originalName, image.name)
        const download = await context.request.get(`${origin}/api/pantry/documents/${receipt.document_id}`)
        assert.equal(download.status(), 200); assert.match(download.headers()['content-type'], /image\/jpeg/)
        const body = await download.body(); cropBodies.push(body)
        assert.notEqual(digest(body), digest(image.buffer))
        const decoded = await page.evaluate(async id => {
          const bitmap = await createImageBitmap(await (await fetch('/api/pantry/documents/' + id)).blob())
          const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
          const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0)
          const pixel = Array.from(ctx.getImageData(5, Math.floor(bitmap.height / 2), 1, 1).data)
          const dimensions = { width: bitmap.width, height: bitmap.height, pixel }; bitmap.close(); return dimensions
        }, receipt.document_id)
        assert.ok(Math.abs(decoded.width - 380) <= 2 && Math.abs(decoded.height - 632) <= 2, 'each crop contains only its selected receipt')
        if (index === 0) assert.ok(decoded.pixel[0] > 245 && decoded.pixel[2] < 250, 'stationery cream paper survives the real crop')
        else assert.ok(decoded.pixel[2] > decoded.pixel[0], 'coffee blue paper survives the real crop')
        const card = page.locator(`#receipt-${receipt.id}`)
        await card.getByText(/Derived receipt/).waitFor()
        const originalLink = card.getByRole('link', { name: /Original capture/ })
        await originalLink.waitFor()
        assert.ok((await originalLink.getAttribute('href')).includes(capture.originalDocumentId))
        await page.screenshot({ path: `${dir}/capture-derived-${index + 1}-${width}.png`, fullPage: true })
      }
      assert.notEqual(digest(cropBodies[0]), digest(cropBodies[1]), 'two regions contain different images')
      // Repeating the same part request is idempotent, through the actual public API.
      const repeated = await context.request.post(`${origin}/api/pantry/receipts/captures/${capture.id}/parts/0`, { headers, multipart: { captureRevision: String(capture.revision), file: { name: 'synthetic-pantry-crop.jpg', mimeType: 'image/jpeg', buffer: cropBodies[0] } } })
      assert.equal(repeated.status(), 200); assert.equal((await repeated.json()).id, split[0].id)
      await page.getByRole('radio', { name: 'One receipt per file', exact: true }).check()
      const pdf = threePagePdf(base + 2), heicName = `synthetic-pantry-${base + 1}.heic`, pdfName = `synthetic-pantry-${base + 2}.pdf`
      await page.getByLabel('Upload a file', { exact: true }).setInputFiles([
        { name: heicName, mimeType: 'image/heic', buffer: heic },
        { name: 'synthetic-pantry-invalid.bin', mimeType: 'application/x-invalid-receipt', buffer: Buffer.from('unsupported receipt format') },
        { name: pdfName, mimeType: 'application/pdf', buffer: pdf },
      ])
      await page.getByRole('list', { name: 'File upload progress' }).getByText(`${pdfName}: Saved for review`, { exact: true }).waitFor()
      await page.getByRole('list', { name: 'File upload progress' }).getByText(`${heicName}: Saved for review`, { exact: true }).waitFor()
      await page.getByRole('list', { name: 'File upload progress' }).getByText('synthetic-pantry-invalid.bin: Failed', { exact: true }).waitFor()
      await page.screenshot({ path: `${dir}/capture-multiple-files-${width}.png`, fullPage: true })
      const receipts = (await (await context.request.get(`${origin}/api/pantry/receipts`)).json()).review
      for (const [name, bytes] of [[heicName, heic], [pdfName, pdf]]) {
        const matching = receipts.filter(r => r.file_name === name)
        assert.equal(matching.length, 1, `${name} is one business document, even when it contains three pages`)
        assert.equal(matching[0].sha256, digest(bytes)); await unchanged(context.request, origin, matching[0].document_id, bytes)
      }
      assert.equal(receipts.filter(r => r.capture?.id === capture.id || [heicName, pdfName].includes(r.file_name)).length, 4)
      const afterBooks = await (await context.request.get(`${origin}/api/pantry/journal`)).json()
      assert.deepEqual(afterBooks.entries, initialBooks.entries, 'capture never posts a financial entry')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `capture fits ${width}`)
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  }
}
