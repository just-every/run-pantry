// Stripe's HTTP API as Pantry uses it: form-encoded calls with the business's
// own key, the key sealed at rest with the installation's session secret, and
// webhook signatures checked before Pantry reads an event.
import type { Bindings } from '../auth.server'
import { Fault, type Data } from './core'

const API = 'https://api.stripe.com/v1'
/** The Stripe API version Pantry is written and tested against, sent on every call so an
 *  account's own default version (new accounts start on the newest) never changes a request. */
export const STRIPE_VERSION = '2026-09-30.endive'

/** Stripe's bracketed form encoding for nested objects and lists. */
export function form(value: Data, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((x: unknown, i) => typeof x === 'object' && x ? form(x as Data, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x)))
    else if (typeof v === 'object') form(v, key, out)
    else out.append(key, String(v))
  }
  return out
}

export async function stripeCall(key: string, method: 'GET' | 'POST' | 'DELETE', path: string, params: Data = {}) {
  const body = form(params), get = method !== 'POST'
  let response: Response
  try {
    response = await fetch(`${API}${path}${get && [...body].length ? `?${body}` : ''}`, { method, headers: { authorization: `Bearer ${key}`, 'stripe-version': STRIPE_VERSION, ...(get ? {} : { 'content-type': 'application/x-www-form-urlencoded' }) }, ...(get ? {} : { body }) })
  } catch {
    throw new Fault(502, 'Pantry could not reach Stripe; try again in a minute')
  }
  const value = await response.json().catch(() => ({})) as Data
  if (!response.ok) throw new Fault(response.status === 401 || response.status === 403 ? 400 : 502, `Stripe refused the request: ${value.error?.message ?? `HTTP ${response.status}`}`)
  return value
}

async function sealKey(env: Bindings) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('pantry-stripe'), info: new TextEncoder().encode('sealed provider keys') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export async function seal(env: Bindings, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(env), new TextEncoder().encode(plain)))
  return `${b64(iv)}.${b64(sealed)}`
}

export async function unseal(env: Bindings, value: string) {
  const [iv, data] = value.split('.')
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await sealKey(env), unb64(data)))
  } catch {
    throw new Fault(409, "Pantry cannot read the saved Stripe key (the installation's session secret changed); connect Stripe again in Settings")
  }
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')

/** Check a Stripe-Signature header (t=…,v1=…) over the raw body, within five minutes. */
export async function verifySignature(secret: string, header: string, body: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = header.split(',').map(p => p.split('=')), t = Number(parts.find(p => p[0] === 't')?.[1])
  const signatures = parts.filter(p => p[0] === 'v1').map(p => p[1])
  if (!Number.isInteger(t) || !signatures.length || Math.abs(nowSeconds - t) > 300) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)))
  return signatures.some(s => s.length === expected.length && [...s].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0)
}

/** RER Managed installs have no route out to providers yet. */
export function managedInstall(env: Bindings) {
  if (!env.RER_INSTALLATION_ID || !env.RER_MANAGEMENT_ORIGIN) return false
  try { return !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.RER_MANAGEMENT_ORIGIN).hostname) } catch { return true }
}
