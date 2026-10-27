import { runMonthCloses } from './month-close'
import { runDueAutopay } from './autopay'
import { sendDueTexts } from './texting'
import { compareStripeEvents } from './stripe-events'
// Due work: the daily CLOSE-004 checks, recurring invoices that have come due, Stripe payments still in
// flight, reminders, economic-nexus alerts, and Stripe payouts and Gusto payrolls to book. Cron runs
// it, and so does any ordinary request once a couple of minutes have passed
// since the last run, so an install without a scheduler still keeps up. Each piece claims its own work, so overlapping runs
// never create or send anything twice.
import type { Bindings } from '../auth.server'
import { now } from './core'
import { one } from './db'
import { businessDay, sendDueReminders, sendingSettings } from './delivery'
import { runDueBills } from './recurring-bills'
import { runDueRecurring } from './recurring'
import { syncPendingCheckouts } from './stripe'
import { syncDuePayouts } from './payouts'
import { syncDuePayrolls } from './gusto/payrolls'
import { runExemptionReminders } from './exemption-reminders'
import { runNexusAlerts } from './nexus'
import { runDueRecognition } from './recognition'
import { runDueRecurringJournals } from './recurring-journals'
import { matchTransfers } from './transfers'
import { runContinuousChecks } from './continuous/run'
import { sendDueApprovalReminders } from './receipts/approval-reminders'
import { runDueReports } from './report-delivery/runs'

const SPACING_MS = 2 * 60 * 1000

export async function runDueWork(env: Bindings, { scheduled = false, reportAt = new Date() } = {}) {
  const db = env.DB
  if (!scheduled) {
    const claimed = await db.prepare('UPDATE pt_due_work SET started_at = ? WHERE id = 1 AND started_at < ?').bind(now(), new Date(Date.now() - SPACING_MS).toISOString()).run()
    if (claimed.meta.changes !== 1) return
  } else await db.prepare('UPDATE pt_due_work SET started_at = ? WHERE id = 1').bind(now()).run()
  if (!await one(db, 'SELECT 1 FROM pt_entity WHERE id = 1')) return
  const today = businessDay((await sendingSettings(db)).time_zone)
  for (const [name, job] of [['scheduled reports', () => runDueReports(env, reportAt)], ['recurring bills', () => runDueBills(db, today)], ['recognition schedules', () => runDueRecognition(db, today)], ['recurring journals', () => runDueRecurringJournals(db, today)], ['transfers', () => matchTransfers(db)], ['continuous checks', () => runContinuousChecks(db, today)], ...(scheduled ? [['monthly close preparation', () => runMonthCloses(db, today)] as const] : []), ['exemption certificates', () => runExemptionReminders(env, db, today)], ['economic nexus', () => runNexusAlerts(env, db)], ['captured draft approvals', () => sendDueApprovalReminders(env, db)], ['recurring invoices', () => runDueRecurring(env, db, today)], ['autopay', () => runDueAutopay(env, db, today)], ['text reminders', () => sendDueTexts(env, db, reportAt)], ['Stripe payments', () => syncPendingCheckouts(env, db)], ['Stripe event comparison', () => compareStripeEvents(env, db)], ['reminders', () => sendDueReminders(env, db, today)], ['Stripe payouts', () => syncDuePayouts(env, db)], ['Gusto payrolls', () => syncDuePayrolls(env, db)]] as const) {
    try { await job() } catch (error) { console.error(`Pantry due work (${name}) failed:`, error) }
  }
}
