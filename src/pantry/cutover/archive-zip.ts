import { inflateRawSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { Fault, requireThat } from '../core'

export const ARCHIVE_BYTES = 8_000_000
const CRC = Uint32Array.from({ length: 256 }, (_, i) => { let n = i; for (let b = 0; b < 8; b++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); return n >>> 0 })
const crc32 = (bytes: Uint8Array) => { let n = 0xffffffff; for (const b of bytes) n = (n >>> 8) ^ CRC[(n ^ b) & 255]; return (n ^ 0xffffffff) >>> 0 }

export function archiveBytes(value: unknown): Uint8Array {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 12_000_000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'Invalid or oversized encoded archive original')
  const bytes = Buffer.from(value, 'base64')
  requireThat(bytes.length <= 9_000_000, 'The ZIP upload exceeds 9 MB')
  return bytes
}

export function archivePath(value: string): string {
  requireThat(value.length > 0 && value.length <= 500 && !/[\\\x00-\x1f]/.test(value) && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..'), 'Archive paths must be unique relative file paths without traversal')
  return value
}

/** Read stored or deflated ZIPs without extracting to a filesystem. Directory sizes
 * bound inflation, and both local headers and CRCs must agree with the index. */
export function archiveZip(bytes: Uint8Array): Map<string, Uint8Array> {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map<string, Uint8Array>()
    let end = bytes.length - 22
    for (; end >= Math.max(0, bytes.length - 65557); end--) if (v.getUint32(end, true) === 0x06054b50 && end + 22 + v.getUint16(end + 20, true) === bytes.length) break
    requireThat(end >= 0, 'The ZIP directory is missing or damaged')
    const count = v.getUint16(end + 10, true), start = v.getUint32(end + 16, true), finish = start + v.getUint32(end + 12, true)
    requireThat(!v.getUint16(end + 4, true) && !v.getUint16(end + 6, true) && v.getUint16(end + 8, true) === count && count <= 200 && finish === end, 'Use a single ZIP with at most 200 entries; ZIP64 is unsupported')
    let pos = start, expanded = 0
    const ranges: [number, number][] = []
    for (let i = 0; i < count; i++) {
      requireThat(pos + 46 <= finish && v.getUint32(pos, true) === 0x02014b50, 'Invalid ZIP directory entry')
      const flags = v.getUint16(pos + 8, true), method = v.getUint16(pos + 10, true), crc = v.getUint32(pos + 16, true), packed = v.getUint32(pos + 20, true), size = v.getUint32(pos + 24, true)
      const length = v.getUint16(pos + 28, true), extra = v.getUint16(pos + 30, true), comment = v.getUint16(pos + 32, true), offset = v.getUint32(pos + 42, true)
      requireThat(pos + 46 + length + extra + comment <= finish && !v.getUint16(pos + 34, true) && !(flags & (1 | 64 | 8192)) && [0, 8].includes(method), 'Encrypted, split or unsupported ZIP entries are refused')
      const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(pos + 46, pos + 46 + length))
      const directory = name.endsWith('/'), path = archivePath(directory ? name.slice(0, -1) : name)
      requireThat(!files.has(name) && ((v.getUint32(pos + 38, true) >>> 16) & 0xf000) !== 0xa000, 'Duplicate ZIP paths and symbolic links are refused')
      expanded += size
      requireThat(expanded <= ARCHIVE_BYTES + 1_000_000 && size <= ARCHIVE_BYTES, 'Expanded archive exceeds 8 MB of originals plus 1 MB of metadata')
      requireThat(offset + 30 <= start && v.getUint32(offset, true) === 0x04034b50 && v.getUint16(offset + 6, true) === flags && v.getUint16(offset + 8, true) === method, 'ZIP local header differs from its directory')
      const localLength = v.getUint16(offset + 26, true), body = offset + 30 + localLength + v.getUint16(offset + 28, true), last = body + packed
      requireThat(last <= start && new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 30, offset + 30 + localLength)) === name && !ranges.some(([a, b]) => offset < b && last > a), 'Overlapping, truncated or mismatched ZIP paths')
      if (!(flags & 8)) requireThat(v.getUint32(offset + 14, true) === crc && v.getUint32(offset + 18, true) === packed && v.getUint32(offset + 22, true) === size, 'ZIP sizes or checksums disagree')
      ranges.push([offset, last])
      const raw = bytes.subarray(body, last), data = method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(1, size) }) : raw
      requireThat(data.length === size && crc32(data) === crc, 'ZIP original size or checksum is invalid')
      requireThat(!directory || size === 0, 'ZIP directory contains file bytes')
      files.set(directory ? path + '/' : path, data)
      pos += 46 + length + extra + comment
    }
    requireThat(pos === finish, 'ZIP directory length is invalid')
    return new Map([...files].filter(([name]) => !name.endsWith('/')))
  } catch (error) {
    if (error instanceof Fault) throw error
    throw new Fault(400, 'The ZIP is damaged or uses unsupported compression; export it again')
  }
}
