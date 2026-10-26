import { runtimeBindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { ownerEmail, who } from '../access'
import { now, type Data } from '../core'
import { audit, changed, q, run } from '../db'
import { sendingSettings } from '../delivery'
import type { Context } from '../context'
import { statementAuthority } from './access'

type MailResult = { status: 'accepted' | 'rejected' | 'rate_limited' | 'uncertain' | 'development'; provider: string; providerMessageId: string | null; code?: string }

export async function sendStatementDeliveries(c: Context, snapshot: Data, deliveries: { id: string; recipient: string }[]) {
  const bindings = runtimeBindings(c.env)
  const mailer = operatorMail(bindings) as unknown as { send(message: Data): Promise<MailResult> } | undefined
  const settings = await sendingSettings(c.db), replyTo = settings.reply_to || await ownerEmail(c.db, c.env)
  const business = snapshot.business_name.replace(/[<>"\\,;:@()[\]]/g, '').trim()
  const from = String(bindings.MAIL_FROM ?? '').trim()
  await Promise.all(deliveries.map(async delivery => {
    let status = 'failed', detail = 'No outgoing mail route is configured', result: MailResult | null = null
    if (mailer && from) {
      let claimed = false
      try {
        await run(c.db, [await statementAuthority(c, true),
          q("UPDATE pt_customer_statement_deliveries SET detail='Provider call started; interruption means outcome uncertain' WHERE id=? AND status='sending' AND detail='' AND finished_at IS NULL", delivery.id), changed()])
        claimed = true
      } catch { detail = 'Your sales access changed before this message could be sent' }
      if (claimed) {
        try {
          result = await mailer.send({ deliveryId: delivery.id,
            from: business ? `${business} <${from.replace(/^.*<([^>]+)>.*$/, '$1')}>` : from,
            to: [delivery.recipient], replyTo, subject: snapshot.subject, text: snapshot.text, html: snapshot.html })
          status = result.status === 'development' ? 'suppressed' : result.status
          detail = status === 'suppressed' ? 'Development mail is suppressed; no email was sent'
            : status === 'accepted' ? 'Accepted by the mail provider; customer receipt is not established'
            : status === 'uncertain' ? 'Provider outcome is uncertain; no automatic resend will occur'
            : `Mail provider returned ${status}`
          if (result.code && /^[a-zA-Z0-9_-]{1,80}$/.test(result.code)) detail += ` (${result.code})`
        } catch (error) {
          const validation = (error as Error)?.name === 'MailValidationError'
          status = validation ? 'failed' : 'uncertain'
          detail = validation ? 'The mail route refused this message before sending'
            : 'Provider outcome is uncertain after a transport error; no automatic resend will occur'
        }
      }
    }
    await run(c.db, [q("UPDATE pt_customer_statement_deliveries SET status=?,provider=?,provider_message_id=?,detail=?,finished_at=? WHERE id=? AND status='sending'", status, result?.provider ?? '', result?.providerMessageId ?? null, detail, now(), delivery.id),
      audit(who(c.actor), 'customer-statement.delivery', 'customer-statement', snapshot.id, { deliveryId: delivery.id, recipient: delivery.recipient, status })])
  }))
}
