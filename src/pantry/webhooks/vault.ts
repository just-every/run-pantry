import { Fault } from '../core'

const encoder = new TextEncoder(), decoder = new TextDecoder()
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
type SecretEnv = { SESSION_SECRET?: string }

async function key(secret: string) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('pantry-webhooks'), info: encoder.encode('signing-secret v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function sealWebhook(env: SecretEnv, plain: string): Promise<string> {
  if (!env.SESSION_SECRET) throw new Fault(503, 'Webhook secret storage is unavailable')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env.SESSION_SECRET), encoder.encode(plain))
  return `v1.${b64(iv)}.${b64(new Uint8Array(data))}`
}

/** A foreign installation or damaged ciphertext cannot produce a signing key. */
export async function openWebhook(env: SecretEnv, sealed: string): Promise<string | null> {
  if (!env.SESSION_SECRET) return null
  try {
    const parts = sealed.split('.')
    if (parts.length !== 3 || parts[0] !== 'v1') return null
    const iv = unb64(parts[1]), data = unb64(parts[2])
    if (iv.length !== 12 || data.length < 16) return null
    return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(env.SESSION_SECRET), data))
  } catch { return null }
}
