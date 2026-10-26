import { now, requireThat, text, uid, type Data } from '../core'
import { all, guard, q, type Sql } from '../db'
import { customerRecipients } from '../customer-profile'

export function noticeTimeZone(value: unknown) {
  const zone = text(value, 'Recipient time zone', 100)
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format() }
  catch { requireThat(false, 'Choose a valid recipient time zone') }
  return zone
}

export async function noticeRecipients(db: D1Database, customer: Data) {
  const saved = await all(db, 'SELECT * FROM pt_autopay_mail_controls WHERE customer_id=?', customer.id)
  return customerRecipients(customer).map(recipient => {
    const row = saved.find(r => r.recipient === recipient)
    return { recipient, timeZone: row?.time_zone ?? '', suppression: row?.suppression ?? null, suppressionSource: row?.suppression ? 'owner_recorded' : null,
      reason: row?.reason ?? '', updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ?? null, revision: row?.revision ?? null }
  })
}

function controlFence(customerId: string, recipient: string, revision: unknown) {
  return revision === null
    ? guard('NOT EXISTS(SELECT 1 FROM pt_autopay_mail_controls WHERE customer_id=? AND recipient=?)', customerId, recipient)
    : guard('EXISTS(SELECT 1 FROM pt_autopay_mail_controls WHERE customer_id=? AND recipient=? AND revision=?)', customerId, recipient, revision)
}

export async function approveNoticeRecipients(db: D1Database, customer: Data, value: unknown, actor: string) {
  const current = await noticeRecipients(db, customer)
  requireThat(Array.isArray(value) && value.length === current.length, 'Set a time zone for every billing and cc email recipient')
  const supplied = value.map(raw => {
    requireThat(raw && typeof raw === 'object' && !Array.isArray(raw), 'Email recipient settings must be objects')
    return { recipient: text(raw.recipient, 'Email recipient', 254).toLowerCase(), timeZone: noticeTimeZone(raw.timeZone) }
  })
  requireThat(new Set(supplied.map(r => r.recipient)).size === current.length && current.every(r => supplied.some(s => s.recipient === r.recipient)), 'Email settings must match the current billing and cc recipients')
  const statements: Sql[] = []
  for (const input of supplied) {
    const saved = current.find(r => r.recipient === input.recipient)!
    statements.push(controlFence(customer.id, input.recipient, saved.revision), q(`INSERT INTO pt_autopay_mail_controls(customer_id,recipient,time_zone,updated_by,updated_at,revision) VALUES(?,?,?,?,?,?)
      ON CONFLICT(customer_id,recipient) DO UPDATE SET time_zone=excluded.time_zone,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=excluded.revision`, customer.id, input.recipient, input.timeZone, actor, now(), uid()))
  }
  return { statements, recipients: supplied }
}

export async function editNoticeRecipient(db: D1Database, customer: Data, input: Data, actor: string) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Choose an email recipient setting')
  const recipient = text(input.recipient, 'Email recipient', 254).toLowerCase()
  const current = (await noticeRecipients(db, customer)).find(r => r.recipient === recipient)
  requireThat(current, 'Choose a current billing or cc email recipient', 409)
  requireThat(input.revision === current.revision, 'Email recipient settings changed; reload before saving', 409)
  const timeZone = input.timeZone === undefined ? noticeTimeZone(current.timeZone) : noticeTimeZone(input.timeZone)
  const suppression = input.suppression === undefined ? current.suppression : input.suppression
  requireThat(suppression === null || suppression === 'bounced' || suppression === 'complained', 'Record an observed bounce or complaint')
  requireThat(!current.suppression || suppression !== null || input.confirmReset === true, 'Explicitly confirm that this email suppression should be reset', 409)
  const reason = input.suppression === undefined ? current.reason : text(input.reason, 'Reason for recording or resetting the observed mail outcome', 500)
  return { recipient, timeZone, suppression, reason, statements: [controlFence(customer.id, recipient, current.revision),
    q(`INSERT INTO pt_autopay_mail_controls(customer_id,recipient,time_zone,suppression,reason,updated_by,updated_at,revision) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(customer_id,recipient) DO UPDATE SET time_zone=excluded.time_zone,suppression=excluded.suppression,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=excluded.updated_at,revision=excluded.revision`, customer.id, recipient, timeZone, suppression, reason, actor, now(), uid())] }
}

export async function noticeMailState(db: D1Database, customerId: string, recipient: string, businessZone: string) {
  const row = (await all(db, 'SELECT * FROM pt_autopay_mail_controls WHERE customer_id=? AND recipient=?', customerId, recipient))[0]
  if (row?.suppression) return { row, status: 'suppressed', detail: `Owner-recorded ${row.suppression}; retry email suppressed` }
  if (!row) return { row, status: 'queued', detail: 'Waiting for the owner to save this email recipient time zone' }
  const at = new Date()
  const open = [businessZone, row.time_zone].every(timeZone => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(at))
    return hour >= 8 && hour < 18
  })
  return { row, status: open ? 'ready' : 'queued', detail: open ? '' : 'Waiting for business and recipient email hours, 08:00 to 18:00' }
}

export const noticeMailFence = (customerId: string, recipient: string, revision: string) => guard('EXISTS(SELECT 1 FROM pt_autopay_mail_controls WHERE customer_id=? AND recipient=? AND revision=? AND suppression IS NULL)', customerId, recipient, revision)
