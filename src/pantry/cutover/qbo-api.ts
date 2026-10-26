// Intuit's own-account Accounting API. Credentials stay sealed in this installation.
import type { Bindings } from '../../auth.server'
import type { Command, Context } from '../context'
import { authority, who } from '../access'
import { date, Fault, now, requireThat, text } from '../core'
import { audit, changed, one, q, run } from '../db'
import { open, seal } from '../feeds/vault'
import { managedInstall } from '../stripe-api'

const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const HOSTS = { sandbox: 'https://sandbox-quickbooks.api.intuit.com', production: 'https://quickbooks.api.intuit.com' }
const ENTITIES = ['Account', 'Customer', 'Vendor', 'Invoice', 'Bill', 'Attachable']
const REPORTS = ['TrialBalance', 'GeneralLedger']
type Grant = { access: string; refresh: string; expiresAt: number }
async function reach(url: string, init: RequestInit) {
  try { return await fetch(url, init) } catch { throw new Fault(502, 'Pantry could not reach Intuit; resume this read when the connection is available') }
}
async function json(response: Response): Promise<any> {
  try { return await response.json() } catch { throw new Fault(502, 'Intuit returned an unreadable response; no records were imported') }
}

export async function qboView(c: Context) {
  const row = await one(c.db, 'SELECT realm_id,environment,connected_at,verified FROM pt_qbo_connection WHERE id=1')
  return { available: !managedInstall(c.env) && !!c.env.QBO_CLIENT_ID && !!c.env.QBO_CLIENT_SECRET, connection: row?.verified ? row : null }
}
async function refresh(env: Bindings, refreshToken: string): Promise<Grant> {
  requireThat(!managedInstall(env), 'QuickBooks reads need a self-hosted installation with provider egress', 409)
  requireThat(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET, 'Set this installation’s Intuit app credentials first', 409)
  const response = await reach(TOKEN, { method: 'POST', headers: { authorization: `Basic ${btoa(`${env.QBO_CLIENT_ID}:${env.QBO_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }) })
  const value = await json(response)
  requireThat(response.ok && typeof value.access_token === 'string' && typeof value.refresh_token === 'string' && Number.isFinite(Number(value.expires_in)) && Number(value.expires_in) > 0, `Intuit refused the grant (HTTP ${response.status}); authorize the company again`, 409)
  return { access: value.access_token, refresh: value.refresh_token, expiresAt: Date.now() + Number(value.expires_in) * 1000 }
}
async function connection(c: Context, pending = false) {
  const row = await one(c.db, 'SELECT * FROM pt_qbo_connection WHERE id=1')
  requireThat(row, 'Connect the QuickBooks company first', 409)
  requireThat(pending || row.verified, 'Authorize and verify the selected QuickBooks company first', 409)
  const plain = await open(c.env.SESSION_SECRET, row.tokens)
  requireThat(plain, 'The saved Intuit grant cannot be opened; connect again', 409)
  let grant = JSON.parse(plain) as Grant
  if (grant.expiresAt < Date.now() + 60_000) {
    grant = await refresh(c.env, grant.refresh)
    // Store Intuit's replacement refresh token before any subsequent request.
    await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_qbo_connection SET tokens=? WHERE id=1', await seal(c.env.SESSION_SECRET, JSON.stringify(grant)))])
  }
  return { row, grant }
}
async function request(c: Context, path: string, pending = false) {
  const { row, grant } = await connection(c, pending)
  const response = await reach(`${HOSTS[row.environment as keyof typeof HOSTS]}/v3/company/${encodeURIComponent(row.realm_id)}/${path}`, { headers: { authorization: `Bearer ${grant.access}`, accept: 'application/json' }, redirect: 'manual' })
  if (response.status === 429) throw new Fault(429, `Intuit asked Pantry to wait ${response.headers.get('retry-after') ?? '60'} seconds; resume this read later`)
  requireThat(response.ok, `Intuit refused the read (HTTP ${response.status})`, 502)
  const body = await json(response)
  requireThat(!body.Fault, 'Intuit could not produce the requested records', 502)
  return body
}
export const qboCommands: Record<string, Command> = {
  'move-in.qbo.connect': { need: 'owner', async run(c, b) {
    const realm = text(b.realmId, 'Intuit company ID', 80), environment = text(b.environment, 'Intuit environment')
    requireThat(/^\d+$/.test(realm) && Object.hasOwn(HOSTS, environment), 'Choose the actual Intuit company and environment')
    const grant = await refresh(c.env, text(b.refreshToken, 'Authorized Intuit refresh token', 3000))
    await run(c.db, [authority(c.actor, 'owner'), q('INSERT INTO pt_qbo_connection(id,realm_id,environment,tokens,connected_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET realm_id=excluded.realm_id,environment=excluded.environment,tokens=excluded.tokens,connected_at=excluded.connected_at,verified=0', realm, environment, await seal(c.env.SESSION_SECRET, JSON.stringify(grant)), now())])
    const company = await request(c, `companyinfo/${encodeURIComponent(realm)}?minorversion=75`, true)
    requireThat(String(company.CompanyInfo?.Id) === realm, 'Intuit did not verify the selected company', 409)
    await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_qbo_connection SET verified=1 WHERE id=1 AND realm_id=? AND environment=?', realm, environment), changed(), audit(who(c.actor), 'move-in.qbo-connect', 'qbo', realm, { environment })])
    return qboView(c)
  } },
  'move-in.qbo.read': { need: 'owner', async run(c, b) {
    const resource = text(b.resource, 'QuickBooks resource')
    if (ENTITIES.includes(resource)) {
      const start = Number(b.start ?? 1)
      requireThat(Number.isSafeInteger(start) && start >= 1, 'Invalid page')
      const query = `SELECT * FROM ${resource} STARTPOSITION ${start} MAXRESULTS 1000`
      const body = await request(c, `query?${new URLSearchParams({ query, minorversion: '75' })}`), rows = body.QueryResponse?.[resource] ?? []
      requireThat(Array.isArray(rows), 'Intuit returned an invalid page', 502)
      return { resource, rows, next: rows.length === 1000 ? start + rows.length : null }
    }
    requireThat(REPORTS.includes(resource), 'Unsupported QuickBooks resource')
    const to = date(b.to, 'Cutover date'), from = date(b.from, 'History start')
    requireThat(from <= to, 'History begins after the cutover date')
    return { resource, report: await request(c, `reports/${resource}?${new URLSearchParams({ start_date: from, end_date: to, accounting_method: 'Accrual', minorversion: '75' })}`) }
  } },
  'move-in.qbo.disconnect': { need: 'owner', async run(c) {
    await run(c.db, [authority(c.actor, 'owner'), q('DELETE FROM pt_qbo_connection WHERE id=1'), audit(who(c.actor), 'move-in.qbo-disconnect', 'qbo', 'local', {})])
    return qboView(c)
  } },
}
