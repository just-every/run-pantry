// Current health is derived from the last successful pull, never the latest
// transaction date (a quiet account can still be fully up to date).
import type { Bindings } from '../../auth.server'
import { longDay, now, type Data } from '../core'
import { all } from '../db'

export type FeedHealthNotice = {
  id: string; itemId: string; institution: string; name: string; kind: 'broken' | 'stale' | 'expiring'
  message: string; key: string; lastSyncedAt: string | null; nextSyncAt: string; requiresRelink: boolean
  notification: { status: string; detail: string; at: string | null }
}
const STALE_MS = 12 * 3600_000
const expiryCodes = new Set(['PENDING_EXPIRATION', 'PENDING_DISCONNECT'])

export async function feedHealth(db: D1Database): Promise<FeedHealthNotice[]> {
  const rows = await all(db, `SELECT i.*, a.id AS alert_id, a.health_key, a.email_status, a.email_detail, a.emailed_at,
      GROUP_CONCAT(b.name || CASE WHEN f.mask <> '' THEN ' ••' || f.mask ELSE '' END, ', ') AS account_names,
      MIN(f.last_synced_at) AS account_sync, COUNT(f.id) AS mapped, COUNT(f.last_synced_at) AS synced
    FROM pt_feed_items i JOIN pt_feed_accounts f ON f.item_id = i.id AND f.bank_account_id IS NOT NULL
    JOIN pt_bank_accounts b ON b.id = f.bank_account_id
    LEFT JOIN pt_feed_alerts a ON a.item_id = i.id AND a.resolved_at IS NULL
    WHERE i.status <> 'disconnected' GROUP BY i.id ORDER BY i.institution_name`)
  return rows.flatMap(i => {
    const last = i.synced === i.mapped ? i.account_sync as string : null
    const stale = Date.now() - Date.parse(last || i.connected_at) > STALE_MS
    const expiring = expiryCodes.has(i.error_code)
    let kind: FeedHealthNotice['kind'], message: string
    if ((i.status === 'relink' && !expiring) || i.last_sync_error || (i.consent_expires_at && Date.parse(i.consent_expires_at) <= Date.now())) {
      kind = 'broken'
      message = i.status === 'relink' ? `${i.institution_name} needs you to sign in again.`
        : i.consent_expires_at && Date.parse(i.consent_expires_at) <= Date.now() ? `${i.institution_name} consent has expired; sign in again.`
        : `${i.institution_name} could not sync. Pantry will try again within the hour.`
    } else if (stale) {
      kind = 'stale'
      message = `${i.institution_name} has not synced ${last ? `since ${longDay(last.slice(0, 10))}` : 'yet'}. Transactions may be missing.`
    } else if (expiring || (i.consent_expires_at && Date.parse(i.consent_expires_at) - Date.now() <= 7 * 86400_000)) {
      kind = 'expiring'
      const days = i.consent_expires_at ? Math.max(0, Math.ceil((Date.parse(i.consent_expires_at) - Date.now()) / 86400_000)) : null
      message = `${i.institution_name} consent expires ${days === null ? 'soon' : `in ${days} day${days === 1 ? '' : 's'}`}; sign in again to keep transactions coming.`
    } else return []
    const key = `${kind}:${kind === 'broken' && i.status === 'relink' ? i.error_code : kind === 'expiring' ? i.consent_expires_at || i.error_code : ''}`
    return [{ id: i.alert_id || i.id, itemId: i.id, institution: i.institution_name, name: i.account_names,
      kind, message, key, lastSyncedAt: last, nextSyncAt: i.sync_due_at,
      requiresRelink: i.status === 'relink' || kind === 'expiring' || !!(i.consent_expires_at && Date.parse(i.consent_expires_at) <= Date.now()),
      notification: { status: i.health_key === key ? i.email_status : 'pending', detail: i.health_key === key ? i.email_detail : '', at: i.health_key === key ? i.emailed_at : null } }]
  })
}

/** A pull must finish after the final instant of the month to cover that month. */
export async function feedCloseExceptions(db: D1Database, end: string): Promise<Data[]> {
  const rows = await all(db, `SELECT f.bank_account_id AS id, b.name, f.mask, f.last_synced_at, i.institution_name
    FROM pt_feed_accounts f JOIN pt_feed_items i ON i.id = f.item_id JOIN pt_bank_accounts b ON b.id = f.bank_account_id
    WHERE i.status <> 'disconnected' AND b.opening_date < ? AND (f.last_synced_at IS NULL OR f.last_synced_at < ?)
    ORDER BY b.name`, end, `${end}T23:59:59.999Z`)
  return rows.map(r => ({ id: r.id, name: r.name, through: r.last_synced_at?.slice(0, 10) ?? null,
    label: `${r.name}${r.mask ? ` ••${r.mask}` : ''} not synced through ${longDay(end)}${r.last_synced_at ? ` (last successful sync ${longDay(r.last_synced_at.slice(0, 10))})` : ' (never synced)'}` }))
}

/** Called by the cron, due pulls and item webhooks, including when pulls fail. */
export async function checkFeedHealth(env: Bindings) {
  // Keep mail construction out of read-only dashboard/close queries.
  const { updateAlerts } = await import('./notifications')
  return updateAlerts(env, await feedHealth(env.DB), now())
}
