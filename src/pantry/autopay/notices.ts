import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { ownerEmail, pantry } from '../access'
import { now, uid, usd, type Data } from '../core'
import { all, audit, changed, one, q, run } from '../db'
import { customerRecipients } from '../customer-profile'
import { sendingSettings } from '../delivery'
import { invoice } from '../invoices'
import { binding, policyState } from './policy'

export async function queueFailureNotice(db: D1Database, attemptId: string) {
  const a = await one(db, 'SELECT * FROM pt_autopay_attempts WHERE id=?', attemptId)
  if (!a || a.status !== 'failed') return
  const c = await one(db, 'SELECT * FROM pt_contacts WHERE id=? AND erased_at IS NULL', a.customer_id)
  if (!c) return
  const inv = await invoice(db, a.invoice_id), subject = `Automatic payment failed: invoice ${inv.number}`
  await run(db, customerRecipients(c).map(recipient => q("INSERT INTO pt_autopay_notices(id,attempt_id,invoice_id,recipient,subject,status,at) VALUES(?,?,?,?,?,'queued',?) ON CONFLICT(attempt_id,recipient) DO NOTHING", uid(), a.id, inv.id, recipient, subject, now())))
}

export async function sendAutopayNotices(env: Bindings, db: D1Database) {
  const settings = await sendingSettings(db)
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: settings.time_zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  if (hour < 8 || hour >= 18) return
  for (const notice of await all(db, "SELECT n.*,a.customer_id,a.sequence,a.amount_cents,a.policy_revision FROM pt_autopay_notices n JOIN pt_autopay_attempts a ON a.id=n.attempt_id WHERE n.status='queued' ORDER BY n.at LIMIT 100")) {
    const state = await policyState(env, db, notice.customer_id), inv = await invoice(db, notice.invoice_id)
    if (!state.valid || !state.consented || state.policy!.revision !== notice.policy_revision || !customerRecipients(state.c).includes(notice.recipient) || inv.status !== 'issued' || inv.void_date || inv.open_cents <= 0) {
      await run(db, [q("UPDATE pt_autopay_notices SET status='cancelled',detail='Authority, recipient or invoice changed',finished_at=? WHERE id=? AND status='queued'", now(), notice.id)])
      continue
    }
    const claimed = await db.prepare("UPDATE pt_autopay_notices SET status='sending' WHERE id=? AND status='queued'").bind(notice.id).run()
    if (claimed.meta.changes !== 1) continue
    let status = 'uncertain', provider = '', providerId = null, detail = ''
    try {
      const fresh = await policyState(env, db, notice.customer_id)
      if (!fresh.valid || !fresh.consented || fresh.policy!.revision !== notice.policy_revision || binding(fresh.c) !== binding(state.c)) { status = 'cancelled'; detail = 'Standing mail consent changed' }
      else {
        const entity = await one(db, 'SELECT legal_name FROM pt_entity WHERE id=1'), days = JSON.parse(fresh.policy!.retry_days), next = days[notice.sequence]
        const body = `${entity?.legal_name ?? 'The business'}\nInvoice ${inv.number}\n\nThe automatic payment of ${usd(notice.amount_cents)} failed. ${next === undefined ? 'Automatic retries are exhausted; ordinary invoice reminders will follow.' : `The next retry is scheduled ${next} days after the first attempt.`}\nYou can revoke automatic payment from your invoice's autopay controls or contact the business.\n`
        const mailer = operatorMail(runtimeBindings(env)) as unknown as { send(message: Data): Promise<{ status: string; provider: string; providerMessageId?: string | null; code?: string }> } | undefined
        if (!mailer || !env.MAIL_FROM) { status = 'failed'; detail = 'The configured mail route is unavailable' }
        else {
          const result = await mailer.send({ deliveryId: notice.id, from: String(env.MAIL_FROM), to: [notice.recipient], subject: notice.subject, text: body, replyTo: settings.reply_to || await ownerEmail(db, env) })
          status = result.status === 'development' ? 'suppressed' : result.status
          provider = result.provider; providerId = result.providerMessageId ?? null; detail = result.code ?? ''
        }
      }
    } catch { detail = 'Mail outcome is unknown; this notice will not be sent again automatically' }
    await run(db, [q('UPDATE pt_autopay_notices SET status=?,provider=?,provider_message_id=?,detail=?,finished_at=? WHERE id=? AND status=\'sending\'', status, provider, providerId, detail, now(), notice.id), changed(), audit(pantry('stripe'), 'autopay.retry-notice', 'invoice', inv.id, { attemptId: notice.attempt_id, noticeId: notice.id, status })])
  }
}
