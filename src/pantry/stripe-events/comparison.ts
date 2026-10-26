import type { Bindings } from '../../auth.server'
import { now, requireThat, uid } from '../core'
import { all, changed, guard, one, q, run } from '../db'
import { managedInstall, stripeCall, unseal } from '../stripe-api'
import { stripeSettings } from '../stripe'
import { processStripeEvent, STRIPE_PAYMENT_EVENTS } from '../stripe-events'

const DAY = 86400

/** A durable descending cursor resumes an interrupted scan without losing its upper bound. */
export async function compareStripeEvents(env: Bindings, db: D1Database, force = false) {
  const settings = await stripeSettings(db)
  if (!settings || managedInstall(env)) return { skipped: true }
  const key = await unseal(env, settings.key_sealed), epoch = Math.floor(Date.now() / 1000)
  let comparison = await one(db, "SELECT * FROM pt_stripe_event_comparisons WHERE account_id=? AND status IN ('running','held') ORDER BY started_at DESC,id DESC LIMIT 1", settings.account_id)
  if (!comparison) {
    const last = await one(db, "SELECT * FROM pt_stripe_event_comparisons WHERE account_id=? AND status='complete' ORDER BY upper_created DESC,id DESC LIMIT 1", settings.account_id)
    if (!force && last && epoch - last.upper_created < DAY) return { skipped: true, comparison: last }
    // Stripe only exposes event payloads for thirty days. Keep the uncovered gap explicit.
    const oldest = epoch - 30 * DAY + 60, desired = last ? last.upper_created - DAY : Math.floor(Date.parse(settings.connected_at) / 1000) - DAY
    const lower = Math.max(oldest, Number.isFinite(desired) ? desired : oldest), id = uid()
    await run(db, [guard('EXISTS(SELECT 1 FROM pt_stripe WHERE account_id=? AND revision=?)', settings.account_id, settings.revision),
      guard("NOT EXISTS(SELECT 1 FROM pt_stripe_event_comparisons WHERE account_id=? AND status IN ('running','held'))", settings.account_id),
      q("INSERT INTO pt_stripe_event_comparisons(id,account_id,started_at,lower_created,upper_created,status,retention_gap,reason) VALUES(?,?,?,?,?,'running',?,?)", id, settings.account_id, now(), lower, epoch, desired < oldest ? 1 : 0, desired < oldest ? 'Some time since the preceding comparison is outside Stripe’s thirty-day event retention; reconcile that interval from provider records.' : '')])
    comparison = (await one(db, 'SELECT * FROM pt_stripe_event_comparisons WHERE id=?', id))!
  }
  const id = comparison.id
  try {
    // Financial writes and outbound notices have their own once-only identities.
    // Retry held identities while continuing to discover older missing events.
    const retries = await all(db, "SELECT event_id FROM pt_stripe_event_comparison_items WHERE run_id=? AND status='held'", id)
    for (const retry of retries) {
      try {
        const result = await processStripeEvent(env, db, { id: retry.event_id })
        await run(db, [q('UPDATE pt_stripe_event_comparison_items SET status=? WHERE run_id=? AND event_id=?', result?.status ?? 'held', id, retry.event_id)])
      } catch { /* Keep the retained identity held; scan the rest of Stripe independently. */ }
    }
    const cursors = new Set<string>(comparison.cursor ? [comparison.cursor] : [])
    // Ten pages per invocation bounds due work; the next invocation resumes this run.
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await stripeCall(key, 'GET', '/events', { types: STRIPE_PAYMENT_EVENTS, created: { gte: comparison.lower_created, lte: comparison.upper_created }, limit: 100, ...(comparison.cursor ? { starting_after: comparison.cursor } : {}) })
      requireThat(Array.isArray(page.data) && typeof page.has_more === 'boolean', 'Stripe event comparison returned an incomplete list', 409)
      for (const event of page.data) {
        requireThat(typeof event.id === 'string', 'Stripe event comparison has an event without identity', 409)
        const old = await one(db, 'SELECT status FROM pt_stripe_events WHERE account_id=? AND id=?', settings.account_id, event.id)
        const missing = !old || !['processed','ignored'].includes(old.status)
        let status: string
        try { status = (await processStripeEvent(env, db, event))?.status ?? 'held' } catch { status = 'held' }
        await run(db, [q(`INSERT INTO pt_stripe_event_comparison_items(run_id,event_id,missing,status) VALUES(?,?,?,?) ON CONFLICT(run_id,event_id) DO UPDATE SET status=excluded.status`, id, event.id, missing ? 1 : 0, status)])
      }
      const cursor = page.data.at(-1)?.id ?? comparison.cursor
      requireThat(!page.has_more || (cursor && !cursors.has(cursor)), 'Stripe event comparison pagination did not advance', 409)
      if (cursor) cursors.add(cursor)
      const unresolved = Number((await one(db, "SELECT COUNT(*) AS n FROM pt_stripe_event_comparison_items WHERE run_id=? AND status='held'", id))?.n ?? 0)
      await run(db, [guard('EXISTS(SELECT 1 FROM pt_stripe WHERE account_id=? AND revision=?)', settings.account_id, settings.revision),
        q("UPDATE pt_stripe_event_comparisons SET cursor=?,status=?,finished_at=?,reason=CASE WHEN ?>0 THEN 'Some events need reconciliation; their identities are retained for a safe retry.' WHEN retention_gap=1 THEN 'The comparison cannot cover time outside Stripe’s thirty-day event retention; reconcile that interval from provider records.' ELSE '' END WHERE id=? AND cursor IS ?", cursor, page.has_more ? 'running' : unresolved ? 'held' : 'complete', page.has_more || unresolved ? null : now(), unresolved, id, comparison.cursor), changed()])
      if (!page.has_more) break
      comparison = (await one(db, 'SELECT * FROM pt_stripe_event_comparisons WHERE id=?', id))!
    }
  } catch {
    await run(db, [q("UPDATE pt_stripe_event_comparisons SET status='held',reason='Stripe event comparison is incomplete; its cursor is retained and no provider outcome was assumed.' WHERE id=? AND status<>'complete'", id)])
  }
  return stripeEventsView(db)
}

export async function stripeEventsView(db: D1Database) {
  const settings = await stripeSettings(db)
  if (!settings) return { runs: [], held: [], disputes: [], missing: [] }
  const [runs, held, disputes] = await Promise.all([
    all(db, `SELECT r.*,(SELECT COUNT(*) FROM pt_stripe_event_comparison_items x WHERE x.run_id=r.id) AS checked,(SELECT COUNT(*) FROM pt_stripe_event_comparison_items x WHERE x.run_id=r.id AND x.missing=1) AS missing_found,(SELECT COUNT(*) FROM pt_stripe_event_comparison_items x WHERE x.run_id=r.id AND x.status='held') AS held_count FROM pt_stripe_event_comparisons r WHERE r.account_id=? ORDER BY r.started_at DESC,r.id DESC LIMIT 30`, settings.account_id),
    all(db, "SELECT * FROM pt_stripe_events WHERE account_id=? AND status IN ('pending','held') ORDER BY provider_created DESC,id LIMIT 100", settings.account_id),
    all(db, 'SELECT * FROM pt_stripe_disputes WHERE account_id=? ORDER BY observed_at DESC,id LIMIT 100', settings.account_id),
  ])
  const latest = runs[0]
  const missing = latest ? await all(db, 'SELECT x.*,e.type,e.object_id,e.session_id,e.reason FROM pt_stripe_event_comparison_items x LEFT JOIN pt_stripe_events e ON e.account_id=? AND e.id=x.event_id WHERE x.run_id=? AND x.missing=1 ORDER BY x.event_id', settings.account_id, latest.id) : []
  return { runs, held, disputes, missing }
}
