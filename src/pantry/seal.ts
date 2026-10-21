// Secrets an owner enters on a page (an AI model key, the private tag of the
// Pantry address) are kept sealed with AES-GCM under a key derived from the
// install's SESSION_SECRET. The credential rows are excluded from archives.
const encoder = new TextEncoder()

async function key(secret: string, purpose: string) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('pantry-seal-v1'), info: encoder.encode(purpose) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0))

export async function seal(secret: string, purpose: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret, purpose), encoder.encode(value)))
  return `v1.${b64(iv)}.${b64(sealed)}`
}

/** The sealed value, or null when this install's secret cannot open it (for example after an import into another install). */
export async function unseal(secret: string, purpose: string, sealed: string): Promise<string | null> {
  const [version, iv, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !data) return null
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(secret, purpose), unb64(data))) }
  catch { return null }
}
