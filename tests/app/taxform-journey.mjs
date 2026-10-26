import assert from 'node:assert/strict'
import { spreadsheet } from '../xlsx.mjs'

async function downloadedBytes(page, link) {
  const [file] = await Promise.all([page.waitForEvent('download'), link.click()])
  assert.equal(await file.failure(), null)
  const stream = await file.createReadStream(), chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return { bytes: Buffer.concat(chunks), filename: file.suggestedFilename() }
}

export async function taxformJourney({ page, context, app, command, vendor, width }) {
  await command('contractor.save', { contactId: vendor.id, is1099: true, legalName: 'Brightline Software', tinKind: 'ein', tin: '000000123', address: '1 Example Street', city: 'Albany', state: 'NY', zip: '12207', backupWithholding: true })
  await page.goto(`${app.origin}/app/reports?report=contractors&year=2026`)
  await page.locator('tr[tabindex]').filter({ hasText: 'Brightline Software' }).click()
  await page.getByRole('button', { name: 'Reveal TIN', exact: true }).click()
  await page.getByText('Confirm your sign-in before revealing tax identity', { exact: true }).waitFor()
  await page.getByLabel('Backup withholding requires review', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Full TIN', { exact: true }).count(), 0)

  const fixture = width === 1440 ? 'synthetic-pantry-601' : 'synthetic-pantry-602'
  const recipient = await command('contact.save', { kind: 'vendor', name: fixture, termsDays: 30 })
  const ledger = await command('account.save', { code: width === 1440 ? '1011' : '1012', name: `${fixture} cash`, type: 'asset', subtype: 'bank' })
  const filingBank = await command('bank-account.save', { name: `${fixture} checking`, institution: 'Example Bank', accountId: ledger.id, numberLast4: '0601', openingDate: '2024-12-31', openingBalance: '0' })
  await command('contractor.save', { contactId: recipient.id, is1099: true, legalName: `Cedar Studio Services ${width}`, tinKind: 'ein', tin: '000000123', address: '22 Example Lane', city: 'Albany', state: 'NY', zip: '12207' })
  for (const [date, amount, method] of [['2025-03-04', '400.00', 'check'], ['2025-06-10', '300.00', 'ach'], ['2025-08-01', '125.00', 'card']]) {
    await command('payment.record', { direction: 'paid', contactId: recipient.id, date, amount, bankAccountId: filingBank.id, method, reference: fixture, allocations: [] })
  }
  const reportUrl = `${app.origin}/app/reports?report=contractors&year=2025`
  await page.goto(reportUrl)
  await page.getByRole('row').filter({ hasText: fixture }).first().waitFor()
  await page.getByText('Default downloads mask TINs.', { exact: false }).waitFor()
  assert.equal((await page.content()).includes('000000123'), false)
  for (const [format, name] of [['csv', 'Download the 2025 1099-NEC CSV'], ['pdf', 'Filing data PDF'], ['xlsx', 'Filing data Excel']]) {
    const link = page.getByRole('link', { name, exact: true })
    assert.equal(new URL(await link.getAttribute('href'), app.origin).searchParams.has('fullTin'), false)
    const { bytes, filename } = await downloadedBytes(page, link)
    assert.ok(filename.endsWith(`.${format}`))
    const contents = format === 'xlsx' ? JSON.stringify(spreadsheet(bytes)) : format === 'pdf' ? bytes.toString('latin1').replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))).replaceAll('\u0095', '•') : bytes.toString('utf8')
    assert.doesNotMatch(contents, /000000123|00-0000123/)
    assert.ok(contents.includes('••-•••0123'), `${format} keeps only the last four TIN digits`)
    assert.ok(contents.includes(`Cedar Studio Services ${width}`), `${format} includes the recipient`)
    if (format === 'csv') assert.match(contents, /700\.00/)
    if (format === 'xlsx') assert.equal(spreadsheet(bytes).find(row => row[5] === `Cedar Studio Services ${width}`)[12], 700)
  }
  await page.getByText('Downloads with full TINs', { exact: true }).click()
  for (const format of ['csv', 'pdf', 'xlsx']) {
    const link = page.getByRole('link', { name: `Full TIN ${format === 'xlsx' ? 'Excel' : format.toUpperCase()}`, exact: true })
    const url = new URL(await link.getAttribute('href'), app.origin)
    assert.equal(url.searchParams.get('fullTin'), 'true')
    const refused = await context.request.get(url.href)
    assert.equal(refused.status(), 403)
    assert.match(await refused.text(), /Confirm your sign-in before revealing tax identity/)
  }
  await page.screenshot({ path: `/tmp/sx-pantry-c60-taxform-${width}.png`, fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const [refusedDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Full TIN CSV', exact: true }).click()])
  assert.ok(await refusedDownload.failure(), 'the browser cannot save a full-TIN file before confirmation')
}
