// Plaid, the feed provider: the installation's own keys, its documented HTTP
// API (https://plaid.com/docs/api/) and nothing else. On RER Managed there is
// no egress for seed integrations yet, so every call is refused with one line.
import type { Bindings } from '../../auth.server'
import { Fault } from '../core'

const HOSTS: Record<string, string> = { sandbox: 'https://sandbox.plaid.com', production: 'https://production.plaid.com' }

/** Plaid's error codes that only the account holder can fix, by signing in again through Link. */
export const RELINK_CODES = new Set(['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'PENDING_DISCONNECT', 'ACCESS_NOT_GRANTED', 'INVALID_UPDATED_USERNAME', 'ITEM_LOCKED', 'USER_SETUP_REQUIRED', 'MFA_NOT_SUPPORTED', 'INSUFFICIENT_CREDENTIALS', 'NO_ACCOUNTS', 'USER_PERMISSION_REVOKED', 'USER_ACCOUNT_REVOKED'])

/** What to tell the owner when only signing in again helps; Plaid's own error_message is for developers. */
export function relinkMessage(code: string, display?: string | null) {
  if (display) return display
  if (code === 'PENDING_EXPIRATION' || code === 'PENDING_DISCONNECT') return 'The bank will stop sharing transactions soon; sign in again to keep them coming.'
  if (code === 'USER_PERMISSION_REVOKED' || code === 'USER_ACCOUNT_REVOKED' || code === 'ACCESS_NOT_GRANTED') return 'Sharing with Pantry was turned off at the bank; re-link to turn it back on.'
  return 'The bank needs you to sign in again.'
}

export class PlaidError extends Error {
  constructor(public code: string, public type: string, message: string, public status: number, public display = '') { super(message) }
  get relink() { return RELINK_CODES.has(this.code) }
}

// needsKeys: this installation has no Plaid account of its own yet; the app shows how to set one up.
export type Availability = { available: true; environment: string } | { available: false; reason: string; needsKeys?: boolean }

/** RER Managed sets RER_INSTALLATION_ID beside a non-loopback management origin. */
function managed(env: Bindings) {
  if (!env.RER_INSTALLATION_ID || !env.RER_MANAGEMENT_ORIGIN) return false
  try { return !['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.RER_MANAGEMENT_ORIGIN).hostname) } catch { return true }
}

export function availability(env: Bindings): Availability {
  if (managed(env)) return { available: false, reason: 'Live bank feeds are not available yet on RER Managed; import statement files instead.' }
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) return { available: false, needsKeys: true, reason: 'Live bank feeds come through Plaid, with a Plaid account of your own, and this Pantry has none set up yet. Until then, import statement files.' }
  const environment = env.PLAID_ENV || 'sandbox'
  if (!HOSTS[environment]) return { available: false, reason: `PLAID_ENV is "${environment}"; use sandbox or production.` }
  return { available: true, environment }
}

export type PlaidAccount = { account_id: string; name: string; official_name?: string | null; mask?: string | null; type: string; subtype?: string | null; balances?: { current?: number | null; available?: number | null } }
export type PlaidTransaction = {
  transaction_id: string; account_id: string; amount: number; date: string; authorized_date?: string | null
  name: string; merchant_name?: string | null; original_description?: string | null; pending: boolean; pending_transaction_id?: string | null
  check_number?: string | null; iso_currency_code?: string | null
}
export type SyncPage = { added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: { transaction_id: string; account_id?: string }[]; next_cursor: string; has_more: boolean; accounts?: PlaidAccount[] }

export function plaid(env: Bindings) {
  const a = availability(env)
  if (!a.available) throw new Fault(503, a.reason)
  const host = HOSTS[a.environment]
  async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(host + path, { method: 'POST', headers: { 'content-type': 'application/json', 'plaid-version': '2020-09-14' }, body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, ...body }) })
    const value: any = await response.json().catch(() => null)
    if (!response.ok || !value) throw new PlaidError(value?.error_code ?? `HTTP_${response.status}`, value?.error_type ?? 'API_ERROR', value?.error_message ?? `Plaid answered ${response.status}`, response.status, value?.display_message ?? '')
    return value as T
  }
  return {
    environment: a.environment,
    /** A Link token for a new connection, or with `accessToken` for re-linking (update mode). */
    linkToken: (o: { userId: string; webhook?: string; accessToken?: string; redirectUri?: string }) => call<{ link_token: string; expiration: string }>('/link/token/create', {
      client_name: 'Pantry', language: 'en', country_codes: ['US'], user: { client_user_id: o.userId },
      ...(o.accessToken ? { access_token: o.accessToken } : { products: ['transactions'], transactions: { days_requested: 730 } }),
      ...(o.webhook ? { webhook: o.webhook } : {}), ...(o.redirectUri ? { redirect_uri: o.redirectUri } : {}),
    }),
    exchange: (publicToken: string) => call<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: publicToken }),
    accounts: (accessToken: string) => call<{ accounts: PlaidAccount[]; item: { item_id: string; institution_id?: string | null; consent_expiration_time?: string | null } }>('/accounts/get', { access_token: accessToken }),
    sync: (accessToken: string, cursor: string) => call<SyncPage>('/transactions/sync', { access_token: accessToken, count: 500, ...(cursor ? { cursor } : {}) }),
    verificationKey: (keyId: string) => call<{ key: JsonWebKey & { kid: string; expired_at: number | null } }>('/webhook_verification_key/get', { key_id: keyId }),
    remove: (accessToken: string) => call<{ request_id: string }>('/item/remove', { access_token: accessToken }),
  }
}
