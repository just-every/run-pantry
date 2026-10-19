import { authority, who } from '../access'
import type { Command } from '../context'
import { now, requireThat, text, uid, type Data } from '../core'
import { audit, guard, one, q, run } from '../db'
import { batchView } from './views'
import { parseFormat, type PayFormat } from './settings'

function formatDay(day: string, format: string) {
  const [y, m, d] = day.split('-')
  return format === 'MM/DD/YYYY' ? `${m}/${d}/${y}` : format === 'MMDDYYYY' ? `${m}${d}${y}` : format === 'YYYYMMDD' ? `${y}${m}${d}` : day
}

export function positivePayCsv(batch: Data, format: PayFormat) {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const rows: string[][] = format.header ? [format.columns.map(c => c.header)] : []
  for (const check of batch.checks) {
    const fields: Record<string, string> = { account: format.account, number: String(check.number), date: formatDay(check.payment_date, format.dateFormat),
      amount: format.amountFormat === 'cents' ? String(check.amount_cents) : (check.amount_cents / 100).toFixed(2), payee: check.payee,
      status: check.status === 'void' ? format.voidCode : format.issueCode, memo: check.memo }
    rows.push(format.columns.map(c => fields[c.field]))
  }
  return rows.map(row => row.map(quote).join(format.delimiter)).join('\r\n') + '\r\n'
}

export const exportPositivePay: Command = { need: 'record', async run(c, b) {
  const batch = await batchView(c.db, text(b.batchId, 'Check batch'))
  const profile = await one(c.db, 'SELECT positive_pay, revision FROM pt_check_profiles WHERE bank_account_id = ?', batch.bank_account_id)
  requireThat(profile, 'Set up the bank’s positive-pay format first', 409)
  const format = parseFormat(JSON.parse(profile.positive_pay)), content = positivePayCsv(batch, format), id = uid()
  // The file is a durable snapshot of this batch's exact issue/void state.
  await run(c.db, [authority(c.actor, 'record'), guard('EXISTS (SELECT 1 FROM pt_check_profiles WHERE bank_account_id = ? AND revision = ?)', batch.bank_account_id, profile.revision),
    ...batch.checks.map((check: Data) => guard('EXISTS (SELECT 1 FROM pt_checks WHERE id = ? AND status = ?)', check.id, check.status)),
    q('INSERT INTO pt_check_exports (id, batch_id, format, content, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, batch.id, JSON.stringify(format), content, c.actor.email, now()),
    audit(who(c.actor), 'check.positive-pay-export', 'check-batch', batch.id, { exportId: id, format: format.name, checks: batch.checks.map((ch: Data) => ({ number: ch.number, status: ch.status, amount: ch.amount_cents })) })])
  return { id, url: `/api/pantry/checks/exports/${id}.csv`, fileName: `positive-pay-${batch.id}.csv` }
} }
