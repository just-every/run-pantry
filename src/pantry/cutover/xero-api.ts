// Xero's documented HTTP API as the move-in uses it: OAuth 2.0 sign-in with the
// installation's own Xero app (https://developer.xero.com/documentation/guides/oauth2/auth-flow),
// the tenant the person chose (GET /connections), and read-only invoices and
// their attachments (Accounting API /Invoices and /Invoices/{id}/Attachments).
// RER Managed has no egress for seed integrations yet, so it is refused with one line.
import { runtimeBindings, type Bindings } from '../../auth.server'
import { Fault } from '../core'
import { managedInstall } from '../stripe-api'

const LOGIN = 'https://login.xero.com/identity/connect/authorize'
const IDENTITY = 'https://identity.xero.com/connect'
const API = 'https://api.xero.com'
/** Granular scopes (apps created since March 2026 get no broad accounting.transactions scope); read-only. */
export const SCOPES = 'openid profile email offline_access accounting.invoices.read accounting.attachments.read'

export type Availability = { available: true } | { available: false; reason: string; needsKeys?: boolean }

export function xeroAvailability(env: Bindings): Availability {
  if (managedInstall(env)) return { available: false, reason: 'Carrying attachments over from Xero is not available yet on RER Managed: it cannot reach Xero until RER adds a provider relay. Upload the files in Documents instead.' }
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) return { available: false, needsKeys: true, reason: 'Carrying attachments over needs a Xero app of your own, and this Pantry has none set up yet. Until then, upload the files in Documents.' }
  return { available: true }
}

export const redirectUri = (env: Bindings) => `${runtimeBindings(env).AUTH_ORIGIN}/api/pantry/xero/callback`

export const authorizeUrl = (env: Bindings, state: string) => `${LOGIN}?${new URLSearchParams({ response_type: 'code', client_id: env.XERO_CLIENT_ID!, redirect_uri: redirectUri(env), scope: SCOPES, state })}`

/** Xero asked Pantry to slow down (HTTP 429); try again after `seconds`. */
export class XeroWait extends Error { constructor(public seconds: number) { super(`Xero asked Pantry to wait ${seconds} seconds`) } }

export type Tokens = { access: string; refresh: string; expiresAt: number }

async function reach(url: string, init: RequestInit) {
  try { return await fetch(url, init) } catch { throw new Fault(502, 'Pantry could not reach Xero; try again in a minute') }
}

async function token(env: Bindings, body: Record<string, string>): Promise<Tokens & { authEventId: string }> {
  const r = await reach(`${IDENTITY}/token`, { method: 'POST', headers: { authorization: `Basic ${btoa(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  const v: any = await r.json().catch(() => ({}))
  if (!r.ok || !v.access_token) throw new Fault(v.error === 'invalid_grant' ? 409 : 502, v.error === 'invalid_grant' ? 'Xero no longer accepts this sign-in; connect Xero again' : `Xero refused the sign-in: ${v.error ?? `HTTP ${r.status}`}`)
  // The access token is a JWT; its authentication_event_id names the tenants this sign-in just authorised.
  let authEventId = ''
  try { authEventId = JSON.parse(atob(v.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).authentication_event_id ?? '' } catch { /* not a JWT: every connection is a candidate */ }
  return { access: v.access_token, refresh: v.refresh_token, expiresAt: Date.now() + Number(v.expires_in ?? 1800) * 1000, authEventId }
}

export const exchangeCode = (env: Bindings, code: string) => token(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env) })
export const refreshTokens = (env: Bindings, refresh: string) => token(env, { grant_type: 'refresh_token', refresh_token: refresh })

export type Connection = { id: string; authEventId?: string; tenantId: string; tenantType: string; tenantName: string }

export async function connections(access: string): Promise<Connection[]> {
  const r = await reach(`${API}/connections`, { headers: { authorization: `Bearer ${access}`, accept: 'application/json' } })
  if (!r.ok) throw new Fault(502, `Xero did not list the organisations: HTTP ${r.status}`)
  return await r.json() as Connection[]
}

/** Ends Pantry's access: the tenant connection, then the refresh token. */
export async function disconnect(env: Bindings, tokens: Tokens, connectionId: string) {
  await reach(`${API}/connections/${connectionId}`, { method: 'DELETE', headers: { authorization: `Bearer ${tokens.access}` } })
  await reach(`${IDENTITY}/revocation`, { method: 'POST', headers: { authorization: `Basic ${btoa(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh }) })
}

/** One Accounting API call for the connected tenant; JSON unless `accept` names a file type. */
export async function accounting(access: string, tenantId: string, path: string, accept = 'application/json') {
  const r = await reach(`${API}/api.xro/2.0${path}`, { headers: { authorization: `Bearer ${access}`, 'xero-tenant-id': tenantId, accept } })
  if (r.status === 429) throw new XeroWait(Math.max(1, Number(r.headers.get('retry-after') ?? 60)))
  if (r.status === 401) throw new Fault(409, 'Xero no longer accepts Pantry’s sign-in; connect Xero again')
  if (r.status === 404) return null
  if (!r.ok) { const v: any = await r.json().catch(() => ({})); throw new Fault(502, `Xero refused ${path.split('?')[0]}: ${v.Detail ?? v.Title ?? `HTTP ${r.status}`}`) }
  return r
}

export type XeroInvoice = { InvoiceID: string; InvoiceNumber: string; Type: 'ACCREC' | 'ACCPAY'; Contact: { Name: string }; HasAttachments?: boolean }
export type XeroAttachment = { AttachmentID: string; FileName: string; MimeType: string; ContentLength: number }
