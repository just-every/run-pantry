import type { Context } from './context'
import { all, one } from './db'
import { ownerSession } from './erasure/owner'
import { readerState } from './receipts/settings'
import { inboxView } from './receipts/mail'
import { availability as plaidAvailability } from './feeds/plaid'
import { availability as gustoAvailability } from './gusto/client'
import { xeroAvailability } from './cutover/xero-api'
import { managedInstall } from './stripe-api'
import { webhookSettings } from './webhooks/commands'
import { SERVICES, UNAVAILABLE } from './data-services'

/** Owner-only, explicit projections: credential storage is never serialised. */
export async function dataFlows(c: Context) {
  await ownerSession(c)
  const [feeds, stripe, gusto, xero, model, inbox, hooks, integrations, agents] = await Promise.all([
    all(c.db, 'SELECT institution_name,status FROM pt_feed_items ORDER BY institution_name'),
    one(c.db, 'SELECT account_name,country,settlement_currency FROM pt_stripe WHERE id=1'),
    one(c.db, 'SELECT company_name FROM pt_gusto WHERE id=1'),
    one(c.db, 'SELECT status,tenant_name FROM pt_xero_connection WHERE id=1'),
    readerState(c.db,c.env), inboxView(c), webhookSettings(c),
    all(c.db,'SELECT id,name,scopes,revoked_at FROM pt_integrations ORDER BY name,id'),
    all(c.db,'SELECT id,name,active FROM pt_agents ORDER BY name,id'),
  ])
  const mailProvider=String(c.env.MAIL_PROVIDER??'development')
  const states: Record<string, { connected: boolean; detail: string; unavailable?: string }> = {
    inkwell: { connected: false, detail: 'Owner-requested previews only; no saved credential or ongoing connection' },
    platter: { connected: false, detail: 'Owner-requested previews only; no saved credential or ongoing connection' },
    hosting: {connected:c.env.AUTH_LOCAL!=='true',detail:c.env.AUTH_LOCAL==='true'?'Local Worker and database; no Cloudflare deployment connection':'Deployed Worker and database in the installation’s configured hosting account'},
    plaid: { connected: feeds.some(f=>f.status==='active'||f.status==='relink'), detail: feeds.map(f=>`${f.institution_name}: ${f.status}`).join('; ') || 'No bank connected', ...(!plaidAvailability(c.env).available ? {unavailable:'Application keys or this hosting path are unavailable; statement files still work.'}: {}) },
    stripe: { connected: !!stripe, detail: stripe?`${stripe.account_name} · ${stripe.country} account · settles ${String(stripe.settlement_currency).toUpperCase()}`:'No Stripe account connected', ...(managedInstall(c.env)?{unavailable:'This hosting path cannot reach Stripe.'}:{}) },
    gusto: { connected: !!gusto, detail: gusto?.company_name ?? 'No payroll company connected', ...(!gustoAvailability(c.env).available?{unavailable:'Application keys or this hosting path are unavailable.'}:{}) },
    xero: { connected: xero?.status==='connected', detail: xero?.tenant_name ?? 'No Xero organisation connected', ...(!xeroAvailability(c.env).available?{unavailable:'Application keys or this hosting path are unavailable; report files still work.'}:{}) },
    model: { connected:'config' in model, detail:'config' in model?`${model.config.provider} · ${model.config.model} · ${new URL(model.config.endpoint).host}`:'Manual capture; model reading and reasoning are off' },
    mail: { connected:!['development','rer'].includes(mailProvider)&&!!c.env.MAIL_API_KEY, detail: mailProvider==='development'?'Local mail is suppressed':mailProvider, ...(mailProvider==='rer'?{unavailable:'Managed mail is a Base route; Pantry Connect mail is unavailable.'}:{}) },
    inbound: { connected:!!inbox.address, detail:inbox.address??'No private capture address configured' },
  }
  return {
    services: SERVICES.map(service=>({...service,...states[service.id]})),
    unavailable: UNAVAILABLE.map(([name,clause,path])=>({name,clause,path,connected:false,sends:'Nothing: no connection is implemented.',receives:'Nothing.',fees:'No connection or fee is offered by Pantry.',broker:'No calls.'})),
    webhooks: hooks.subscriptions.map((s: Record<string, any>)=>({id:s.id,host:s.host,events:s.events,enabled:s.enabled,payload:hooks.payloadFields})),
    integrations:integrations.map(i=>({id:i.id,name:i.name,scopes:JSON.parse(i.scopes),active:!i.revoked_at})),
    agents:agents.map(a=>({id:a.id,name:a.name,active:!!a.active})),
    pricesChecked:'2026-10-22',
  }
}
