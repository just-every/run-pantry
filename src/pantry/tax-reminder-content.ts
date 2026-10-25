import type { Context } from './context'
import { ownerEmail } from './access'
import { all, guard, one, type Sql } from './db'
import { requireThat, usd, type Data } from './core'
import { contact } from './contacts'

export const BATCH_CAP = 10, DAILY_CAP = 25
export async function taxItems(c: Context, year: number) {
  requireThat(Number.isInteger(year) && year >= 2000 && year <= 2100, 'Choose a tax year')
  const deadlines = await all(c.db, 'SELECT * FROM pt_tax_deadlines WHERE due_date BETWEEN ? AND ? AND completed_at IS NULL ORDER BY due_date,id', `${year}-01-01`, `${year+1}-12-31`)
  const to = await ownerEmail(c.db, c.env)
  return deadlines.map(d => ({ deadlineId:d.id, revision:d.revision, name:'Owner', label:d.label, to, dueDate:d.due_date, amountCents:d.amount_cents,
    subject:'Tax-readiness reminder', body:`Recorded deadline: ${d.label} — ${d.due_date}.${d.amount_cents === null ? '' : ` Estimated amount: ${usd(d.amount_cents)} (estimate).`} Review the recorded deadline in Pantry. This is a readiness reminder, never tax advice, payment authorization or a filing.` }))
}
export async function vendorItems(c: Context, ids: unknown, reminder: boolean) {
  requireThat(Array.isArray(ids) && ids.length > 0 && ids.length <= BATCH_CAP && new Set(ids).size === ids.length, 'Select one to ten distinct vendors')
  const items: Data[] = []
  for (const id of ids) {
    const v = await contact(c.db, String(id), 'vendor')
    requireThat(v.active && !v.erased_at, 'Vendor is inactive', 409)
    requireThat(!await one(c.db,'SELECT 1 FROM pt_tax_vendor_stops WHERE contact_id=?',v.id), 'This vendor opted out',409)
    requireThat(/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(v.email), 'Add a valid vendor email first')
    const tax = await one(c.db,'SELECT revision,w9_completed_at,erased_at FROM pt_contractor_tax WHERE contact_id=?',v.id)
    requireThat(!tax?.w9_completed_at || tax.erased_at, 'Vendor already has a W-9',409)
    items.push({contactId:v.id,contactRevision:v.revision,taxRevision:tax?.revision??null,name:v.name,to:v.email.toLowerCase(),subject:reminder?'Reminder: private W-9 request':'Private W-9 request',body:`${reminder?'Reminder: please':'Please'} complete your W-9 using the private link below. Never reply with your taxpayer identification number. The new link expires in fourteen days and closes after one submission. You can opt out of future W-9 email on that page. A new link replaces any earlier link.`})
  }
  return items
}
export function itemGuards(items: Data[]): Sql[] {
  return items.flatMap(i => i.contactId ? [
    guard('EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND revision=? AND lower(email)=? AND active=1 AND erased_at IS NULL)',i.contactId,i.contactRevision,i.to),
    guard('NOT EXISTS(SELECT 1 FROM pt_tax_vendor_stops WHERE contact_id=?)',i.contactId),
    guard('(SELECT revision FROM pt_contractor_tax WHERE contact_id=?) IS ?',i.contactId,i.taxRevision),
    guard('NOT EXISTS(SELECT 1 FROM pt_contractor_tax WHERE contact_id=? AND w9_completed_at IS NOT NULL AND erased_at IS NULL)',i.contactId),
  ] : [guard("EXISTS(SELECT 1 FROM oa_operators WHERE lower(email)=? AND role='owner' AND status='active')",i.to),guard('EXISTS(SELECT 1 FROM pt_tax_deadlines WHERE id=? AND revision=? AND completed_at IS NULL)',i.deadlineId,i.revision)])
}
const escaped = (s: string) => s.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,')
export function calendar(items: Data[], stamp: string) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Pantry//Tax readiness//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH']
  for (const i of items) lines.push('BEGIN:VEVENT',`UID:${encodeURIComponent(String(i.deadlineId))}@pantry.local`,`DTSTAMP:${stamp.replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${i.dueDate.replace(/-/g,'')}`,`SUMMARY:${escaped(`Tax readiness: ${i.label}`)}`,`DESCRIPTION:${escaped(i.body)}`,'BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-P1D','DESCRIPTION:Review recorded tax deadline','END:VALARM','END:VEVENT')
  lines.push('END:VCALENDAR')
  // Fold by UTF-8 octets as required for a standard iCalendar file.
  return lines.flatMap(line => {
    const out: string[] = []; let part='', size=0
    for (const ch of line) { const n = new TextEncoder().encode(ch).length; if(size+n>75){out.push(part);part=' ';size=1} part+=ch;size+=n }
    out.push(part);return out
  }).join('\r\n')+'\r\n'
}
