// Keep a multi-tenant OAuth result sealed until the person who connected Xero
// chooses an organization. Only names and connection ids reach the move-in page.
import { authority, who } from '../access'
import type { Command, Context } from '../context'
import { now, requireThat, text, type Data } from '../core'
import { audit, changed, q, run } from '../db'
import { open, seal } from '../feeds/vault'
import type { Connection, Tokens } from './xero-api'

export const STATE_MINUTES = 15
export const SIGN_IN_EXPIRED = 'This Xero sign-in was not started here or has expired; connect Xero again'

export async function pendingSelection(c: Context, link: Data | null): Promise<{ tokens: Tokens; choices: Connection[] } | null> {
  if (link?.status !== 'pending' || !link.state || link.state_by !== c.actor.email || Date.parse(link.state_at) <= Date.now() - STATE_MINUTES * 60_000 || !link.tokens) return null
  const plain = await open(c.env.SESSION_SECRET, link.tokens)
  if (!plain) return null
  const { choices, ...tokens } = JSON.parse(plain)
  return choices?.length ? { tokens, choices } : null
}

export async function completeConnection(c: Context, tokens: Tokens, org: Connection, state: string) {
  await run(c.db, [authority(c.actor, 'record'),
    q("UPDATE pt_xero_connection SET status = 'connected', state = NULL, tenant_id = ?, tenant_name = ?, connection_id = ?, tokens = ?, connected_by = ?, connected_at = ? WHERE id = 1 AND state = ? AND state_by = ?",
      org.tenantId, org.tenantName, org.id, await seal(c.env.SESSION_SECRET, JSON.stringify({ access: tokens.access, refresh: tokens.refresh, expiresAt: tokens.expiresAt })), c.actor.email, now(), state, c.actor.email), changed(),
    audit(who(c.actor), 'move-in.xero-connect', 'xero', org.tenantId, { tenant: org.tenantName })])
}

export const chooseOrganization: Command = { need: 'record', async run(c, body) {
  const link = await c.db.prepare('SELECT * FROM pt_xero_connection WHERE id = 1').first<Data>()
  const selection = await pendingSelection(c, link)
  requireThat(selection, SIGN_IN_EXPIRED, 409)
  const org = selection.choices.find(x => x.id === text(body.connectionId, 'Xero organization', 200))
  requireThat(org, 'Choose one Xero organization when Xero asks, then connect again', 409)
  await completeConnection(c, selection.tokens, org, link!.state)
  return { connected: true }
} }
