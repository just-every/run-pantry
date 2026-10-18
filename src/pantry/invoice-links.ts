// One custody policy for the page, PDF and payment door of an invoice link.
import { authority, who } from './access'
import { now, requireThat, text } from './core'
import { audit, changed, one, q, run } from './db'
import { invoice } from './invoices'
import type { Command } from './context'

export const LINK_TOKEN = /^[A-Za-z0-9_-]{32}$/

export async function ensureLink(db: D1Database, invoiceId: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  await db.prepare('UPDATE pt_invoices SET link_token = ? WHERE id = ? AND link_token IS NULL').bind(token, invoiceId).run()
  return (await one<{ link_token: string }>(db, 'SELECT link_token FROM pt_invoices WHERE id = ?', invoiceId))!.link_token
}

export async function invoiceByLink(db: D1Database, token: string) {
  if (!LINK_TOKEN.test(token)) return null
  const row = await one(db, "SELECT id FROM pt_invoices WHERE link_token = ? AND kind = 'invoice' AND status = 'issued'", token)
  if (!row) return null
  const inv = await invoice(db, row.id)
  if (inv.open_cents <= 0) {
    const settlement = await one<{ at: string | null }>(db, `SELECT MAX(a.created_at) AS at FROM pt_allocations a
      LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
      WHERE a.target_kind = 'invoice' AND a.target_id = ? AND (a.source_kind = 'credit' OR p.reversal_id IS NULL)`, inv.id)
    if (settlement?.at && Date.parse(settlement.at) + inv.link_days_after_payment * 86400000 <= Date.now()) return null
  }
  return inv
}

const revoke: Command = { need: 'record', async run(c, b) {
  const inv = await invoice(c.db, text(b.id, 'Invoice'))
  requireThat(inv.kind === 'invoice' && inv.link_token, 'This invoice has no customer link', 409)
  await run(c.db, [authority(c.actor, 'record'),
    q('UPDATE pt_invoices SET link_token = NULL WHERE id = ? AND link_token = ?', inv.id, inv.link_token), changed(),
    audit(who(c.actor), 'invoice.link-revoked', 'invoice', inv.id)])
  return invoice(c.db, inv.id)
} }

const policy: Command = { need: 'record', async run(c, b) {
  const inv = await invoice(c.db, text(b.id, 'Invoice'))
  requireThat(inv.kind === 'invoice', 'Choose an invoice', 409)
  const days = Number(b.daysAfterPayment)
  requireThat(b.daysAfterPayment !== '' && b.daysAfterPayment !== null && Number.isInteger(days) && days >= 0 && days <= 3650, 'Link expiry is 0–3650 whole days after payment')
  await run(c.db, [authority(c.actor, 'record'),
    q('UPDATE pt_invoices SET link_days_after_payment = ? WHERE id = ?', days, inv.id), changed(),
    audit(who(c.actor), 'invoice.link-policy', 'invoice', inv.id, { daysAfterPayment: days, at: now() })])
  return invoice(c.db, inv.id)
} }

export const invoiceLinkCommands: Record<string, Command> = {
  'invoice.link-revoke': revoke,
  'invoice.link-policy': policy,
}
