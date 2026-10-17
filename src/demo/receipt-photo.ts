// The demo's Home Depot receipt as the PNG photo the owner took: the receipt
// the homepage shows, with the day the demo's card line posted printed in its
// date (MM/DD/YY), so what Pantry read matches the photo.
import { DIGITS, PHOTO, PIXELS } from './receipt-photo-data'

const base64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer())
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer)
  view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** The photo for `day` (YYYY-MM-DD) as PNG bytes. */
export async function receiptPhoto(day: string): Promise<Uint8Array> {
  const { width, height, cell: [cw, ch], digits } = PHOTO
  const pixels = await through(base64(PIXELS), new DecompressionStream('deflate')), glyphs = await through(base64(DIGITS), new DecompressionStream('deflate'))
  const [y, m, d] = day.split('-')
  ;[...`${m}${d}${y.slice(2)}`].forEach((digit, i) => {
    const [x0, y0] = digits[i], g = Number(digit)
    for (let row = 0; row < ch; row++)
      pixels.set(glyphs.subarray((row * cw * 10 + g * cw) * 3, (row * cw * 10 + (g + 1) * cw) * 3), ((y0 + row) * width + x0) * 3)
  })
  // PNG rows: a filter byte (none) before each row of RGB.
  const rows = new Uint8Array(height * (width * 3 + 1))
  for (let row = 0; row < height; row++) rows.set(pixels.subarray(row * width * 3, (row + 1) * width * 3), row * (width * 3 + 1) + 1)
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header.set([8, 2, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', await through(rows, new CompressionStream('deflate'))), chunk('IEND', new Uint8Array(0))]
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (png.set(p, at), at + p.length), 0)
  return png
}
