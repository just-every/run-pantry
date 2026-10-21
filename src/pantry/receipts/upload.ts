import { requireThat } from '../core'

export const MEDIA = /^(application\/pdf|image\/(png|jpeg|webp|gif|heic|heif)|text\/plain|message\/rfc822)$/

export async function bytesOf(value: FormDataEntryValue | null, max: number, label: string) {
  if (!value || typeof value === 'string') return null
  requireThat(value.size > 0 && value.size <= max, `${label} is 1 byte to ${Math.round(max / 1_000_000)} MB`, 413)
  // Some browsers send a saved email or a PDF with no type; the file name says what it is.
  const byName = /\.eml$/i.test(value.name) ? 'message/rfc822' : /\.pdf$/i.test(value.name) ? 'application/pdf' : /\.jpe?g$/i.test(value.name) ? 'image/jpeg' : /\.png$/i.test(value.name) ? 'image/png' : /\.hei[cf]$/i.test(value.name) ? 'image/heic' : 'application/octet-stream'
  return { name: value.name || 'receipt', mediaType: value.type && value.type !== 'application/octet-stream' ? value.type : byName, bytes: new Uint8Array(await value.arrayBuffer()) }
}

