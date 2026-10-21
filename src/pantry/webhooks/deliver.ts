import type { Bindings } from '../../auth.server'
import { uid } from '../core'
import { all, one } from '../db'
import { destination } from './destination'
import { openWebhook } from './vault'

type Claim = { id: string; event_id: string; subscription_id: string; host: string; attempt: number; lease_until: string }
type Event = { id: string; type: string; at: string; kind: string; record_id: string; revision: string; status: string }
type ErrorClass = 'timeout' | 'network' | 'tls' | 'redirect' | 'http' | 'destination_refused' | 'secret_unavailable'
type Result = { outcome: 'succeeded' | 'failed'; statusCode: number | null; errorClass: ErrorClass | null }
const encoder = new TextEncoder()
const retryDelays = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]
const failed = (errorClass: ErrorClass, statusCode: number | null = null): Result => ({ outcome: 'failed', statusCode, errorClass })

async function signature(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '.' + body)))
  return 'v1=' + [...bytes].map(n => n.toString(16).padStart(2, '0')).join('')
}

async function post(url: string, eventId: string, body: string, timestamp: string, signatures: string[]): Promise<Result> {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('timeout')) }, 10_000)
  })
  try {
    const request = fetch(url, { method: 'POST', redirect: 'manual', credentials: 'omit', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Pantry-Event-Id': eventId, 'Pantry-Timestamp': timestamp, 'Pantry-Signature': signatures.join(', ') }, body })
    // Observe status only. Even a fetch implementation that settles after the
    // abort must release its stream without retaining provider response data.
    const response = await Promise.race([request.then(response => {
      const status = response.status
      void response.body?.cancel().catch(() => {})
      return status
    }), timeout])
    if (response >= 200 && response < 300) return { outcome: 'succeeded', statusCode: response, errorClass: null }
    return failed(response >= 300 && response < 400 ? 'redirect' : 'http', response)
  } catch (error) {
    if (timedOut) return failed('timeout')
    const message = error instanceof Error ? error.message : ''
    return failed(/certificate|\btls\b|\bssl\b|CERT_|ERR_TLS|ERR_SSL/i.test(message) ? 'tls' : 'network')
  } finally { clearTimeout(timer) }
}

const claimGuard = `id = ? AND state = 'sending' AND attempt = ? AND lease_until = ?`
const claimParams = (claim: Claim) => [claim.id, claim.attempt, claim.lease_until]

async function deliver(env: Bindings, claim: Claim, stamp: string, scheduledTime: number) {
  const started = Date.now(), db = env.DB
  const event = await one<Event>(db, 'SELECT id,type,at,kind,record_id,revision,status FROM pt_webhook_events WHERE id = ?', claim.event_id)
  if (!event) return
  const subscription = await one<{ destination: string; host: string }>(db,
    'SELECT destination,host FROM pt_webhook_subscriptions WHERE id = ? AND enabled = 1 AND deleted_at IS NULL', claim.subscription_id)
  if (!subscription) {
    await db.prepare(`UPDATE pt_webhook_deliveries SET state = 'cancelled', lease_until = NULL WHERE ${claimGuard}`)
      .bind(...claimParams(claim)).run()
    return
  }
  let result: Result | undefined, target: string | undefined
  try {
    const checked = destination(subscription.destination)
    if (checked.host !== subscription.host || checked.host !== claim.host) result = failed('destination_refused')
    else target = checked.destination
  } catch { result = failed('destination_refused') }
  const body = JSON.stringify({ id: event.id, type: event.type, time: event.at,
    record: { kind: event.kind, id: event.record_id, revision: event.revision, status: event.status } })
  const timestamp = String(Math.floor(Date.now() / 1000))
  let signatures: string[] = []
  if (!result) {
    const rows = await all<{ sealed: string }>(db,
      'SELECT sealed FROM pt_webhook_secrets WHERE subscription_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY id', claim.subscription_id, stamp)
    const secrets = await Promise.all(rows.map(row => openWebhook(env, row.sealed)))
    if (!secrets.length || secrets.some(secret => !secret)) result = failed('secret_unavailable')
    else signatures = await Promise.all(secrets.map(secret => signature(secret!, timestamp, body)))
  }
  // The last database read before transport rechecks consent and the lease;
  // erasure/disable/reclaim may have occurred during decryption or signing.
  const active = await one(db, `SELECT d.id FROM pt_webhook_deliveries d JOIN pt_webhook_subscriptions s ON s.id = d.subscription_id
    WHERE d.id = ? AND d.state = 'sending' AND d.attempt = ? AND d.lease_until = ?
      AND s.enabled = 1 AND s.deleted_at IS NULL AND s.destination = ?`, ...claimParams(claim), subscription.destination)
  if (!active) {
    await db.prepare(`UPDATE pt_webhook_deliveries SET state = 'cancelled', lease_until = NULL
      WHERE ${claimGuard} AND NOT EXISTS (SELECT 1 FROM pt_webhook_subscriptions
        WHERE id = pt_webhook_deliveries.subscription_id AND enabled = 1 AND deleted_at IS NULL AND destination = ?)`)
      .bind(...claimParams(claim), subscription.destination).run()
    return
  }
  result ??= await post(target!, event.id, body, timestamp, signatures)
  const state = result.outcome === 'succeeded' ? 'succeeded' : claim.attempt >= 6 ? 'failed' : 'pending'
  const next = new Date(scheduledTime + Math.max(0,Date.now()-started) + (retryDelays[claim.attempt - 1] ?? 0)).toISOString()
  const attemptId = uid()
  // Both writes run in one D1 transaction. A cancelled or reclaimed claim can
  // neither append stale history nor return a delivery to the pending queue.
  await db.batch([
    db.prepare(`INSERT INTO pt_webhook_attempts
      (id,delivery_id,event_id,type,kind,record_id,revision,status,host,attempt,at,outcome,status_code,error_class,duration_ms)
      SELECT ?,id,?,?,?,?,?,?,host,attempt,?,?,?,?,? FROM pt_webhook_deliveries WHERE ${claimGuard}`)
      .bind(attemptId, event.id, event.type, event.kind, event.record_id, event.revision, event.status, stamp,
        result.outcome, result.statusCode, result.errorClass, Math.max(0, Date.now() - started), ...claimParams(claim)),
    db.prepare(`UPDATE pt_webhook_deliveries SET state = ?, next_at = ?, lease_until = NULL
      WHERE ${claimGuard} AND EXISTS (SELECT 1 FROM pt_webhook_attempts WHERE id = ?)`)
      .bind(state, next, ...claimParams(claim), attemptId),
  ])
}

/** Concurrent invocations share atomic claims; event IDs survive every retry. */
export async function runWebhooks(env: Bindings, scheduledTime = Date.now()): Promise<void> {
  const stamp = new Date(scheduledTime).toISOString(), lease = new Date(scheduledTime + 30_000).toISOString()
  const claimed = await env.DB.batch([
    env.DB.prepare(`UPDATE pt_webhook_deliveries SET state = 'failed', lease_until = NULL
      WHERE state = 'sending' AND lease_until <= ? AND attempt >= 6`).bind(stamp),
    env.DB.prepare(`UPDATE pt_webhook_deliveries SET state = 'sending', attempt = attempt + 1, lease_until = ?
      WHERE id IN (SELECT d.id FROM pt_webhook_deliveries d JOIN pt_webhook_subscriptions s ON s.id = d.subscription_id
        WHERE s.enabled = 1 AND s.deleted_at IS NULL AND d.attempt < 6
          AND ((d.state = 'pending' AND d.next_at <= ?) OR (d.state = 'sending' AND d.lease_until <= ?))
        ORDER BY d.next_at,d.id LIMIT 20)
      RETURNING id,event_id,subscription_id,host,attempt,lease_until`).bind(lease, stamp, stamp),
  ])
  await Promise.all((claimed[1].results as Claim[]).map(claim => deliver(env, claim, stamp, scheduledTime)))
}
