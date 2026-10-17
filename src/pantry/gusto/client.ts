// Gusto, the payroll provider: this installation's own Gusto app (client id
// and secret), its documented API (https://docs.gusto.com/app-integrations)
// and nothing else. OAuth2 authorization code; access tokens last two hours and
// each refresh token works once, so a refreshed pair is stored before use.
// On RER Managed there is no egress for seed integrations yet.
import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { Fault, type Data } from '../core'
import { managedInstall } from '../stripe-api'

const HOSTS: Record<string, string> = { demo: 'https://api.gusto-demo.com', production: 'https://api.gusto.com' }
export const API_VERSION = '2026-06-15'

export type Availability = { available: true; environment: string; redirectUri: string } | { available: false; reason: string }

export function availability(env: Bindings): Availability {
  if (managedInstall(env)) return { available: false, reason: 'Payroll from Gusto is not available yet on RER Managed: managed installs cannot reach Gusto until RER adds a provider relay.' }
  if (!env.GUSTO_CLIENT_ID || !env.GUSTO_CLIENT_SECRET) return { available: false, reason: 'Payroll from Gusto needs this installation’s own Gusto app: set GUSTO_CLIENT_ID and GUSTO_CLIENT_SECRET (and GUSTO_ENV=production once Gusto approves it).' }
  const environment = env.GUSTO_ENV || 'demo'
  if (!HOSTS[environment]) return { available: false, reason: `GUSTO_ENV is "${environment}"; use demo or production.` }
  return { available: true, environment, redirectUri: `${runtimeBindings(env).AUTH_ORIGIN}/api/pantry/gusto/callback` }
}

export class GustoError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export type Tokens = { access_token: string; refresh_token: string; expires_in: number }
/** Gusto's payroll totals: strings to the cent. */
export type Totals = Record<string, string | null | undefined>
export type Payroll = {
  uuid?: string; payroll_uuid?: string; company_uuid?: string; check_date: string; processed: boolean; off_cycle?: boolean; external?: boolean
  pay_period?: { start_date?: string; end_date?: string }; processed_date?: string | null; totals?: Totals
}

export function gusto(env: Bindings) {
  const a = availability(env)
  if (!a.available) throw new Fault(503, a.reason)
  const host = HOSTS[a.environment]
  async function call<T>(method: 'GET' | 'POST', path: string, { token, body, query }: { token?: string; body?: Data; query?: Record<string, string> } = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${host}${path}${query ? `?${new URLSearchParams(query)}` : ''}`, { method, headers: { accept: 'application/json', 'x-gusto-api-version': API_VERSION, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    } catch {
      throw new GustoError('Pantry could not reach Gusto; try again in a minute', 502)
    }
    const value: any = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = value?.error_description ?? value?.errors?.[0]?.message ?? value?.message ?? value?.error ?? `HTTP ${response.status}`
      throw new GustoError(`Gusto refused the request: ${detail}`, response.status)
    }
    return value as T
  }
  const grant = (body: Data) => call<Tokens>('POST', '/oauth/token', { body: { client_id: env.GUSTO_CLIENT_ID, client_secret: env.GUSTO_CLIENT_SECRET, redirect_uri: a.redirectUri, ...body } })
  return {
    environment: a.environment, redirectUri: a.redirectUri,
    authorizeUrl: (state: string) => `${host}/oauth/authorize?${new URLSearchParams({ client_id: env.GUSTO_CLIENT_ID!, redirect_uri: a.redirectUri, response_type: 'code', state })}`,
    exchange: (code: string) => grant({ code, grant_type: 'authorization_code' }),
    refresh: (refreshToken: string) => grant({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
    tokenInfo: (token: string) => call<{ scope?: string; resource?: { type: string; uuid: string } | null }>('GET', '/v1/token_info', { token }),
    company: (token: string, uuid: string) => call<{ uuid: string; name?: string; trade_name?: string | null }>('GET', `/v1/companies/${encodeURIComponent(uuid)}`, { token }),
    /** Processed regular and off-cycle payrolls with their totals, one page of up to 100. */
    payrolls: (token: string, uuid: string, startDate: string, endDate: string, page: number) => call<Payroll[]>('GET', `/v1/companies/${encodeURIComponent(uuid)}/payrolls`, { token, query: { processing_statuses: 'processed', payroll_types: 'regular,off_cycle', include: 'totals', start_date: startDate, end_date: endDate, page: String(page), per: '100' } }),
  }
}
