// Claim once, keep an in-app reminder even when this installation cannot send
// mail, and record the mail provider's actual outcome.
import { runtimeBindings, type Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { ownerEmail, pantry } from './access'
import { addDays, now } from './core'
import { all, audit, q, run } from './db'

export async function runExemptionReminders(env: Bindings, db: D1Database, today: string) {
  const rows = await all(db, `SELECT e.id, e.certificate_number, e.expires_on, e.states, c.name AS customer_name
    FROM pt_exemption_certificates e JOIN pt_contacts c ON c.id = e.customer_id
    WHERE e.active = 1 AND e.expires_on <= ? AND NOT EXISTS (SELECT 1 FROM pt_exemption_reminders r WHERE r.certificate_id = e.id)`, addDays(today, 30))
  for (const e of rows) {
    const claim = await db.prepare('INSERT OR IGNORE INTO pt_exemption_reminders (certificate_id, reminded_at) VALUES (?, ?)').bind(e.id, now()).run()
    if (claim.meta.changes !== 1) continue
    const bindings = runtimeBindings(env), mailer = operatorMail(bindings), to = await ownerEmail(db, env)
    let status = 'in-app', detail = 'The expiry reminder is visible in Customers & vendors.'
    if (mailer && to && bindings.MAIL_FROM) {
      try {
        const text = `${e.customer_name}'s certificate ${e.certificate_number} covers ${JSON.parse(e.states).join(', ')} and expires on ${e.expires_on}.\n\nUpload a renewed certificate before expiry to keep exempt treatment. An expired certificate cannot exempt new invoices. Issued invoices retain their original evidence.\n\nManage certificates: ${bindings.AUTH_ORIGIN}/app/sales?tab=contacts`
        const result = await mailer.send({ deliveryId: `exemption-${e.id}`, from: bindings.MAIL_FROM, to: [to],
          subject: `Exemption certificate ${e.expires_on < today ? 'expired' : 'expires soon'}: ${e.customer_name}`,
          text, html: `<pre>${text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!))}</pre>`, headers: {} })
        status = result.status
        detail = result.providerMessageId ?? result.status
      } catch { status = 'failed'; detail = 'Mail could not be sent; the expiry reminder remains visible in Pantry.' }
    }
    await run(db, [q('UPDATE pt_exemption_reminders SET email_status = ?, email_detail = ? WHERE certificate_id = ?', status, detail, e.id), audit(pantry('reminders'), 'exemption.reminder', 'exemption', e.id, { status, expiresOn: e.expires_on })])
  }
}
