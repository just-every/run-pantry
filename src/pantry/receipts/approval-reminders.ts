// A captured draft revision gets one owner reminder after it has been pending
// for a day. The durable claim makes cron and ordinary-request replays safe.
import { runtimeBindings, type Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { ownerEmail, pantry } from '../access'
import { now } from '../core'
import { all, audit, q, run } from '../db'

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/** Send each still-pending captured revision once, after 24 hours. */
export async function sendDueApprovalReminders(env: Bindings, db: D1Database, stamp = now()) {
  const due = await all<{ id: string; receipt_id: string; revision: string; kind: string; payload: string }>(db, `
    SELECT d.id, d.receipt_id, d.revision, d.kind, d.payload FROM pt_capture_drafts d
    JOIN pt_receipts r ON r.id = d.receipt_id
    WHERE d.status = 'draft' AND r.status = 'review'
      AND julianday(d.updated_at) <= julianday(?) - 1
      AND NOT EXISTS (SELECT 1 FROM pt_capture_approval_reminders m WHERE m.draft_id = d.id AND m.revision = d.revision)
    ORDER BY d.updated_at, d.id`, stamp)
  const bindings = runtimeBindings(env), mailer = operatorMail(bindings), recipient = await ownerEmail(db, env)
  const reminded: string[] = []
  for (const draft of due) {
    // Claim before contacting the provider. An uncertain or failed send is kept
    // for inspection and never duplicated by a cron/public due replay.
    const claimed = await db.prepare(`INSERT OR IGNORE INTO pt_capture_approval_reminders
      (draft_id, revision, reminded_at, recipient, email_status, email_detail)
      SELECT ?, ?, ?, ?, 'sending', 'Mail send in progress'
      WHERE EXISTS (SELECT 1 FROM pt_capture_drafts d JOIN pt_receipts r ON r.id = d.receipt_id
        WHERE d.id = ? AND d.revision = ? AND d.status = 'draft' AND r.status = 'review'
          AND julianday(d.updated_at) <= julianday(?) - 1)`)
      .bind(draft.id, draft.revision, stamp, recipient, draft.id, draft.revision, stamp).run()
    if (claimed.meta.changes !== 1) continue

    let status = 'no-mail', detail = 'No configured owner address or mail sender.'
    if (mailer && bindings.MAIL_FROM && recipient) {
      try {
        const payload = JSON.parse(draft.payload), link = `${bindings.AUTH_ORIGIN}/app/receipts#receipt-${encodeURIComponent(draft.receipt_id)}`
        const subject = `Pantry: captured ${draft.kind} needs approval`
        const body = `A captured ${draft.kind} for ${payload.vendor} has been waiting for approval for more than a day.\n\nReview and approve it after signing in: ${link}\n`
        const result = await mailer.send({ deliveryId: `capture-approval-${draft.id}-${draft.revision}`, from: bindings.MAIL_FROM, to: [recipient], subject, text: body,
          html: `<p>${escape(body).replaceAll('\n', '<br>')}</p>`, headers: {} })
        status = result.status
        detail = [result.provider, result.providerMessageId].filter(Boolean).join(': ') || result.status
      } catch {
        status = 'failed'; detail = 'The mail provider could not send the approval reminder.'
      }
    }
    await run(db, [q(`UPDATE pt_capture_approval_reminders SET email_status = ?, email_detail = ?
      WHERE draft_id = ? AND revision = ? AND email_status = 'sending'`, status, detail, draft.id, draft.revision),
      audit(pantry('reminders'), 'capture-draft.reminder', 'capture-draft', draft.id, { revision: draft.revision, recipient, status })])
    reminded.push(draft.id)
  }
  return reminded
}
