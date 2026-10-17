// A plain ZIP archive (stored, not compressed) of named files, which every spreadsheet
// program and operating system opens. Enough for the accountant package; no streaming.
const table = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** The archive's bytes; `at` dates every entry (DOS time, so to the even second). */
export function zip(files: { name: string; data: Uint8Array | string }[], at = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = []
  const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1)
  const date = ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate()
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data)
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true)
    l.setUint16(10, time, true); l.setUint16(12, date, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true)
    l.setUint16(26, name.length, true); l.setUint16(28, 0, true); local.set(name, 30)
    const entry = new Uint8Array(46 + name.length), e = new DataView(entry.buffer)
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x0800, true); e.setUint16(10, 0, true)
    e.setUint16(12, time, true); e.setUint16(14, date, true); e.setUint32(16, crc, true); e.setUint32(20, data.length, true); e.setUint32(24, data.length, true)
    e.setUint16(28, name.length, true); e.setUint32(42, offset, true); entry.set(name, 46)
    parts.push(local, data); central.push(entry); offset += local.length + data.length
  }
  const size = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), d = new DataView(end.buffer)
  d.setUint32(0, 0x06054b50, true); d.setUint16(8, files.length, true); d.setUint16(10, files.length, true); d.setUint32(12, size, true); d.setUint32(16, offset, true)
  const out = new Uint8Array(offset + size + 22)
  let at_ = 0
  for (const p of [...parts, ...central, end]) { out.set(p, at_); at_ += p.length }
  return out
}
