export type Region = { x: number; y: number; width: number; height: number }
export const MAX_FILE_BYTES = 25_000_000
export const MAX_REGIONS = 20
export const validRegion = (r: Region) => Object.values(r).every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001

/** Decode the actual photo, not its extension. Its original bytes never pass through canvas. */
export async function photo(file: File) {
  if (!/^image\/(jpeg|png)$/i.test(file.type)) throw new Error('Choose a JPEG or PNG photo to split. Upload other formats as one receipt per file.')
  try { return await createImageBitmap(file) }
  catch { throw new Error('This photo could not be opened. Choose a readable JPEG or PNG.') }
}

export async function crop(bitmap: ImageBitmap, r: Region, name: string, index: number): Promise<File> {
  if (!validRegion(r)) throw new Error('Keep each rectangle inside the photo with a width and height above zero.')
  const sx = Math.floor(r.x * bitmap.width), sy = Math.floor(r.y * bitmap.height)
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(r.width * bitmap.width)))
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(r.height * bitmap.height)))
  const scale = Math.min(1, 2400 / Math.max(sw, sh)), canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not prepare the receipt image.')
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('This browser could not save the receipt image.')), 'image/jpeg', 0.88))
  if (blob.size > 4_000_000) throw new Error('This receipt crop exceeds 4 MB. Choose a smaller rectangle before saving.')
  return new File([blob], `${name.replace(/\.[^.]+$/, '')}-receipt-${index + 1}.jpg`, { type: 'image/jpeg' })
}
