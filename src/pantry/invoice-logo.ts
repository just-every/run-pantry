// JPEG logos are embedded in the PDF. No external image requests, SVG scripts,
// or browser image decoders participate in issuing a document.
import { requireThat } from './core'
export type InvoiceLogo = { base64: string; width: number; height: number; components: number }
export function invoiceLogo(raw: unknown): InvoiceLogo | null {
  if (raw === null || raw === undefined || raw === '') return null
  requireThat(typeof raw === 'string' && raw.length <= 140000 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw), 'Upload a JPEG logo of at most 100 KB')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0)) } catch { requireThat(false, 'Invalid JPEG encoding') }
  requireThat(bytes.length <= 100000 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217, 'Upload a complete JPEG logo of at most 100 KB')
  for (let p = 2; p + 8 < bytes.length;) {
    requireThat(bytes[p++] === 255, 'Invalid JPEG logo')
    while (bytes[p] === 255) p++
    const marker = bytes[p++], length = bytes[p] * 256 + bytes[p + 1]
    if (marker === 0xda || marker === 0xd9) break
    requireThat(length >= 2 && p + length <= bytes.length, 'Invalid JPEG logo')
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = bytes[p + 3] * 256 + bytes[p + 4], width = bytes[p + 5] * 256 + bytes[p + 6], components = bytes[p + 7]
      requireThat(bytes[p + 2] === 8 && width > 0 && height > 0 && width <= 4000 && height <= 4000 && [1, 3].includes(components), 'Use an 8-bit RGB or grayscale JPEG, up to 4000 × 4000 pixels')
      return { base64: raw, width, height, components }
    }
    p += length
  }
  requireThat(false, 'Use a baseline or progressive RGB or grayscale JPEG')
}
export const bytesBase64 = (bytes: Uint8Array) => {
  let raw = ''
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(raw)
}
export const base64Bytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
