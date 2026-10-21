// Read downloaded XLSX cells without importing the application's writer.
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
export function spreadsheet(bytes) {
  const archive = Buffer.from(bytes), files = new Map()
  for (let at = 0; archive.readUInt32LE(at) === 0x04034b50;) {
    const method = archive.readUInt16LE(at + 8), size = archive.readUInt32LE(at + 18)
    const nameLength = archive.readUInt16LE(at + 26), extraLength = archive.readUInt16LE(at + 28)
    const name = archive.subarray(at + 30, at + 30 + nameLength).toString()
    const start = at + 30 + nameLength + extraLength, body = archive.subarray(start, start + size)
    assert.ok([0, 8].includes(method)); files.set(name, (method === 8 ? inflateRawSync(body) : body).toString())
    at = start + size
  }
  assert.ok(files.has('[Content_Types].xml')); assert.ok(files.has('xl/workbook.xml'))
  const xml = files.get('xl/worksheets/sheet1.xml'); assert.ok(xml)
  assert.doesNotMatch(xml, /<f[ >]/, 'labels and notes never execute as formulas')
  const unescape = text => text.replace(/&(#13|quot|gt|lt|amp);/g, (_, key) => ({ '#13': '\r', quot: '"', gt: '>', lt: '<', amp: '&' })[key])
  return [...xml.matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)].map(row => [...row[1].matchAll(/<c\b([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)].map(cell => {
    if (/t="inlineStr"/.test(cell[1])) return unescape(cell[2].match(/<t\b[^>]*>(.*?)<\/t>/s)?.[1] ?? '')
    return cell[2]?.match(/<v>(.*?)<\/v>/s) ? Number(cell[2].match(/<v>(.*?)<\/v>/s)[1]) : null
  }))
}
export async function downloadSpreadsheet(origin, path, cookie) {
  const response = await fetch(origin + '/api/pantry/' + path, { headers: { cookie } })
  assert.equal(response.status, 200, path)
  assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.match(response.headers.get('content-disposition'), /\.xlsx"$/)
  return spreadsheet(await response.arrayBuffer())
}
