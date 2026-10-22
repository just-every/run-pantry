// Recurring bills create drafts; approval and posting still use the bill doors.
import { dimensionTags, dimensionValues } from './dimensions'
import { authority, who } from './access'
import type { Command } from './context'
import { addDays, date, Fault, now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, audit, changed, guard, one, periodOpen, q, run } from './db'
import { parseBill } from './payables'
import { occurrence } from './recurring'

const actor = { email: 'pantry:recurring-bills', kind: 'system' as const }
async function template(db: D1Database, id: string): Promise<Data> {
  const row = await one(db, 'SELECT * FROM pt_recurring_bills WHERE id=?', id)
  requireThat(row, 'Recurring bill not found', 404)
  return { ...row, lines: JSON.parse(row.lines) }
}
const save: Command = { need: 'record', async run(c, b) {
  const start = date(b.startDate, 'First bill date'), end = b.endDate ? date(b.endDate, 'Last bill date') : null
  requireThat(!end || end >= start, 'Last bill date must follow the first')
  const p = await parseBill(c.db, { ...b, billDate: start, reference: b.name })
  const terms = b.termsDays === undefined || b.termsDays === '' ? p.vendor.terms_days : Number(b.termsDays)
  requireThat(Number.isInteger(terms) && terms >= 0 && terms <= 365, 'Payment terms are 0–365 days')
  const unit = b.unit ?? 'month', every = Number(b.every ?? 1)
  requireThat(['week', 'month', 'year'].includes(unit) && Number.isInteger(every) && every >= 1 && every <= 12, 'Repeat every 1–12 weeks, months or years')
  const before = b.id ? await template(c.db, text(b.id, 'Recurring bill')) : null
  if (before) {
    requireThat(before.revision === b.revision, 'Recurring bill changed; reload', 409)
    requireThat(!before.runs || (before.start_date === start && before.every === every && before.unit === unit), 'Keep a used schedule anchor; create another template to change it', 409)
  }
  const id = before?.id ?? uid(), revision = uid(), lines = p.lines.map(l => ({ ...dimensionTags(l),description: l.description, accountId: l.accountId, amount: (l.amount / 100).toFixed(2) }))
  const next = occurrence(start, unit, every, before?.runs ?? 0), nextDate = end && next > end ? null : next
  const name = text(b.name, 'Template name', 60)
  await run(c.db, [authority(c.actor, 'record'), ...(before ? [
    q('UPDATE pt_recurring_bills SET name=?,vendor_id=?,lines=?,memo=?,terms_days=?,start_date=?,end_date=?,every=?,unit=?,next_date=?,status=?,prepared_by=?,revision=? WHERE id=? AND revision=? AND runs=?', name, p.vendor.id, JSON.stringify(lines), p.memo, terms, start, end, every, unit, nextDate, nextDate ? before.status === 'paused' ? 'paused' : 'active' : 'ended', c.actor.email, revision, id, b.revision, before.runs), changed(),
  ] : [q('INSERT INTO pt_recurring_bills (id,name,vendor_id,lines,memo,terms_days,start_date,end_date,every,unit,next_date,status,prepared_by,revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, name, p.vendor.id, JSON.stringify(lines), p.memo, terms, start, end, every, unit, nextDate, 'active', c.actor.email, revision, now())]),
    audit(who(c.actor), 'recurring-bill.save', 'recurring-bill', id, { revision, name, start, end, unit, every, creates: 'drafts' })])
  return template(c.db, id)
} }

const status: Command = { need: 'record', async run(c, b) {
  const t = await template(c.db, text(b.id, 'Recurring bill'))
  requireThat(t.revision === b.revision && t.status !== 'ended', 'Template changed or ended; reload', 409)
  requireThat(['active', 'paused'].includes(b.status), 'Pause or resume this schedule')
  await run(c.db, [authority(c.actor, 'record'), q('UPDATE pt_recurring_bills SET status=? WHERE id=? AND revision=?', b.status, t.id, t.revision), changed(), audit(who(c.actor), 'recurring-bill.status', 'recurring-bill', t.id, { status: b.status })])
  return template(c.db, t.id)
} }

export async function runDueBills(db: D1Database, today: string) {
  for (const row of await all(db, "SELECT id FROM pt_recurring_bills WHERE status='active' AND next_date<=? ORDER BY next_date,id", today)) {
    for (let i = 0; i < 12; i++) {
      const t = await template(db, row.id)
      if (t.status !== 'active' || !t.next_date || t.next_date > today) break
      const day = t.next_date, next = occurrence(t.start_date, t.unit, t.every, t.runs + 1), ended = t.end_date && next > t.end_date
      const fence = guard("EXISTS (SELECT 1 FROM pt_recurring_bills WHERE id=? AND revision=? AND runs=? AND status='active')", t.id, t.revision, t.runs)
      const advance = q('UPDATE pt_recurring_bills SET runs=runs+1,next_date=?,status=? WHERE id=? AND revision=? AND runs=?', ended ? null : next, ended ? 'ended' : 'active', t.id, t.revision, t.runs)
      let p: Awaited<ReturnType<typeof parseBill>>
      try {
        p = await parseBill(db, { vendorId: t.vendor_id, reference: `${t.name} ${day}`, billDate: day, dueDate: addDays(day, t.terms_days), memo: t.memo, lines: t.lines })
        requireThat(!await one(db, "SELECT 1 FROM pt_periods WHERE status='locked' AND ? BETWEEN start_date AND end_date", day), `${day} is locked; prepare a bill after reopening`, 409)
      } catch (e) {
        if (!(e instanceof Fault)) throw e
        try { await run(db, [fence, q("INSERT INTO pt_recurring_bill_runs VALUES (?,?,?,NULL,'blocked',?,?)", t.id, day, t.revision, e.message, now()), advance, changed(), audit(actor, 'recurring-bill.blocked', 'recurring-bill', t.id, { occurrence: day, reason: e.message })]) }
        catch (error) { if (!await one(db, 'SELECT 1 FROM pt_recurring_bill_runs WHERE recurring_id=? AND occurrence=?', t.id, day)) throw error }
        continue
      }
      const id = uid(), revision = uid()
      try {
        await run(db, [fence, periodOpen(day),
          q("INSERT INTO pt_bills (id,vendor_id,reference,bill_date,due_date,status,memo,total_cents,opening,prepared_by,revision,created_at) VALUES (?,?,?,?,?,'draft',?,?,0,?,?,?)", id, p.vendor.id, p.reference, day, p.dueDate, p.memo, p.total, t.prepared_by, revision, now()),
          ...p.lines.map((l, index) => q('INSERT INTO pt_bill_lines (id,bill_id,line_no,description,account_id,amount_cents,class_name,location_name,project_name) VALUES (?,?,?,?,?,?,?,?,?)', uid(), id, index + 1, l.description, l.accountId, l.amount,...dimensionValues(l))),
          q("INSERT INTO pt_recurring_bill_runs VALUES (?,?,?,?,'drafted','Draft awaits normal bill review and posting',?)", t.id, day, t.revision, id, now()), advance, changed(),
          audit(actor, 'bill.draft', 'bill', id, { template: t.id, templateRevision: t.revision, occurrence: day }), audit(actor, 'recurring-bill.run', 'recurring-bill', t.id, { billId: id, occurrence: day })])
      } catch (error) {
        if (!await one(db, 'SELECT 1 FROM pt_recurring_bill_runs WHERE recurring_id=? AND occurrence=?', t.id, day)) throw error
      }
    }
  }
}

const generate: Command = { need: 'record', async run(c, b) {
  const through = date(b.through, 'Generate through')
  requireThat(through <= new Date().toISOString().slice(0, 10), 'Generate only occurrences due by today')
  await run(c.db, [authority(c.actor, 'record')])
  await runDueBills(c.db, through)
  return recurringBillsView(c.db)
} }

export const recurringBillCommands: Record<string, Command> = { 'recurring-bill.save': save, 'recurring-bill.status': status, 'recurring-bill.generate': generate }
export async function recurringBillsView(db: D1Database) {
  const templates = await all(db, 'SELECT r.*,c.name AS vendor_name FROM pt_recurring_bills r JOIN pt_contacts c ON c.id=r.vendor_id ORDER BY r.name,r.id')
  const runs = await all(db, 'SELECT r.*,b.reference FROM pt_recurring_bill_runs r LEFT JOIN pt_bills b ON b.id=r.bill_id ORDER BY r.occurrence DESC')
  for (const t of templates) { t.lines = JSON.parse(t.lines); t.history = runs.filter(r => r.recurring_id === t.id) }
  return templates
}
