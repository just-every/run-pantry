import { addDays, date, requireThat, type Data } from '../core'
import { businessDay, sendingSettings } from '../delivery'

// The business calendar is frozen with the revision, so later sending-setting
// changes cannot silently lengthen a customer's acceptance window.
export async function estimateValidity(db: D1Database, value: unknown, issueDate: string) {
  if (value === undefined || value === null || value === '') return null
  const validUntil = date(value, 'Valid until')
  requireThat(validUntil >= issueDate, 'Valid until cannot be before the estimate date')
  const timeZone = (await sendingSettings(db)).time_zone
  const midnight = Date.parse(addDays(validUntil, 1) + 'T00:00:00Z')
  let cutoff = midnight
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(cutoff)).map(p => [p.type, p.value]))
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
    cutoff = midnight - (local - cutoff)
  }
  requireThat(businessDay(timeZone, new Date(cutoff - 1)) === validUntil, 'Choose a valid date on the business calendar')
  return { validUntil, timeZone, expiresAt: new Date(cutoff).toISOString() }
}

export const estimateExpired = (pricing: Data, at = new Date()) => Boolean(pricing.validity && at.toISOString() >= pricing.validity.expiresAt)
