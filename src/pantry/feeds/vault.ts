// Feed access tokens rest encrypted (AES-GCM, key derived from the
// installation's session secret), so an export or a copied database does not
// carry a working bank connection. Restored elsewhere, a connection asks to re-link.
const te = new TextEncoder(), td = new TextDecoder()
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

async function key(secret: string) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('pantry-feeds'), info: te.encode('access-token v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function seal(secret: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), te.encode(plain)))
  return `v1.${b64(iv)}.${b64(sealed)}`
}

/** The token, or null when this installation's secret did not seal it. */
export async function open(secret: string, sealed: string) {
  const [v, iv, data] = sealed.split('.')
  if (v !== 'v1' || !iv || !data) return null
  try { return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(secret), unb64(data))) } catch { return null }
}
