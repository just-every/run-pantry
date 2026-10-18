// One email per incident; repeated webhooks and concurrent scans share a claim.
// Recovered incidents remain in history. Failed deliveries retry after an hour;
// an uncertain provider acceptance is retained for inspection, never resent.
import { runtimeBindings, type Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { ownerEmail } from '../access'
import { uid, type Data } from '../core'
import { all, q, run } from '../db'
import type { FeedHealthNotice } from './health'

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export async function updateAlerts(env: Bindings, notices: FeedHealthNotice[], stamp: string) {
  const db = env.DB
  // Refresh current state while serializing against another scan's insert.
  await run(db, [
    q(`UPDATE pt_feed_alerts SET resolved_at = ? WHERE resolved_at IS NULL AND NOT EXISTS (
      SELECT 1 FROM json_each(?) n WHERE json_extract(n.value, '$.itemId') = pt_feed_alerts.item_id AND json_extract(n.value, '$.key') = pt_feed_alerts.health_key)`, stamp, JSON.stringify(notices.map(n => ({ itemId: n.itemId, key: n.key })))),
    ...notices.map(n => q(`INSERT OR IGNORE INTO pt_feed_alerts (id, item_id, health_key, kind, message, detected_at, next_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, uid(), n.itemId, n.key, n.kind, n.message, stamp, stamp)),
  ])
  const due = await all(db, `SELECT * FROM pt_feed_alerts WHERE resolved_at IS NULL AND
    ((email_status IN ('pending', 'failed', 'no-mail') AND next_attempt_at <= ?) OR (email_status = 'sending' AND claim_until < ?))`, stamp, stamp)
  const e = runtimeBindings(env), mailer = operatorMail(e), to = await ownerEmail(db, env)
  for (const row of due) {
    const claim = uid(), later = new Date(Date.now() + 3600_000).toISOString()
    const r = await db.prepare(`UPDATE pt_feed_alerts SET email_status = 'sending', claim_id = ?, claim_until = ? WHERE id = ? AND resolved_at IS NULL
      AND (claim_until IS NULL OR claim_until < ?)
      AND ((email_status IN ('pending', 'failed', 'no-mail') AND next_attempt_at <= ?) OR (email_status = 'sending' AND claim_until < ?))`)
      .bind(claim, new Date(Date.now() + 300_000).toISOString(), row.id, stamp, stamp, stamp).run()
    if (r.meta.changes !== 1) continue
    let status = 'no-mail', detail = 'Set up a mail provider and sender to receive feed alerts by email.'
    const notice = notices.find(n => n.itemId === row.item_id && n.key === row.health_key)
    if (!notice) continue
    const link = `${e.AUTH_ORIGIN}/app/bank`
    const body = `${notice.message}\n\n${notice.name}\nLast successful sync: ${notice.lastSyncedAt ?? 'never'}.\n${notice.requiresRelink ? 'Open Bank and card feeds and choose Re-link.' : 'Open Bank and card feeds to check the connection or sync now.'}\n\n${link}\n\nA month with missing feed days stays an exception at close until the feed catches up.\n`
    if (mailer && e.MAIL_FROM && to) {
      try {
        const sent = await mailer.send({ deliveryId: row.id, headers: {}, from: e.MAIL_FROM, to: [to], subject: `Pantry: ${notice.message}`, text: body, html: `<p>${escape(body).replaceAll('\n', '<br>')}</p>` }) as Data
        status = sent.status === 'development' ? 'local' : sent.status === 'accepted' ? 'sent' : sent.status === 'uncertain' ? 'uncertain' : 'failed'
        detail = status === 'local' ? 'This computer sends no email; the feed alert is shown in Pantry.' : status === 'sent' ? 'Email accepted by the mail provider.' : status === 'uncertain' ? 'The mail provider could not confirm delivery; check the connection in Pantry.' : 'The mail provider refused the alert; Pantry will try again within the hour.'
      } catch {
        status = 'failed'; detail = 'The mail provider could not be reached; Pantry will try again within the hour.'
      }
    }
    await run(db, [q('UPDATE pt_feed_alerts SET email_status = ?, email_detail = ?, emailed_at = ?, next_attempt_at = ?, claim_id = NULL, claim_until = NULL WHERE id = ? AND claim_id = ?',
      status, detail, ['sent', 'local', 'uncertain'].includes(status) ? stamp : null, later, row.id, claim)])
  }
  return { checked: notices.length }
}
