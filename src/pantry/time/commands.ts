import { authority, who } from '../access'
import { date, now, optionalText, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run } from '../db'
import type { Command, Context } from '../context'

export async function timePeople(c: Context) {
  requireThat(c.actor.kind === 'person', 'A person records time', 403)
  if (c.actor.role === 'owner') return all(c.db, "SELECT email, name FROM pt_members WHERE active = 1 UNION SELECT lower(email), display_name FROM oa_operators WHERE role = 'owner' AND status = 'active' ORDER BY email")
  const emails = [...new Set([c.actor.email, ...(c.actor.policy?.timePeople ?? [])])]
  const names = await all(c.db, `SELECT email, name FROM pt_members WHERE active = 1 AND email IN (${emails.map(() => '?').join(',')}) UNION SELECT lower(email), display_name FROM oa_operators WHERE status = 'active' AND lower(email) IN (${emails.map(() => '?').join(',')})`, ...emails, ...emails)
  return names
}
export async function timeView(c: Context) {
  const people = await timePeople(c), emails = people.map(p => p.email), owner = c.actor.kind === 'person' && c.actor.role === 'owner'
  const entries = owner || emails.length ? await all(c.db, `SELECT t.id, t.person_email, t.recorded_by, t.customer_id, t.project_id, t.item_id, t.work_date, t.minutes, t.note, t.revision, t.invoice_id IS NOT NULL AS invoiced, c.name AS customer, p.name AS project, i.name AS service FROM pt_time_entries t JOIN pt_contacts c ON c.id = t.customer_id JOIN pt_time_projects p ON p.id = t.project_id JOIN pt_items i ON i.id = t.item_id WHERE ${owner ? '1=1' : `t.person_email IN (${emails.map(() => '?').join(',')})`} ORDER BY t.work_date DESC, t.created_at DESC LIMIT 500`, ...(owner ? [] : emails)) : []
  return { people, customers: await all(c.db, "SELECT id, name FROM pt_contacts WHERE kind = 'customer' AND active = 1 AND erased_at IS NULL ORDER BY name"), projects: await all(c.db, 'SELECT id, name, customer_id FROM pt_time_projects WHERE active = 1 ORDER BY name'), services: await all(c.db, "SELECT id, name FROM pt_items WHERE kind = 'service' AND active = 1 ORDER BY name"), entries }
}
const projectSave: Command = { need: 'record', async run(c, b) {
  requireThat(c.actor.kind === 'person' && c.actor.role !== 'time-only', 'The owner or billing staff sets up projects', 403)
  const customer = await one(c.db, "SELECT id FROM pt_contacts WHERE id = ? AND kind = 'customer' AND active = 1 AND erased_at IS NULL", text(b.customerId, 'Customer'))
  requireThat(customer, 'Choose an active customer')
  const id = uid(), revision = uid(), name = text(b.name, 'Project name', 200)
  await run(c.db, [authority(c.actor, 'record'), q('INSERT INTO pt_time_projects(id,customer_id,name,revision) VALUES(?,?,?,?)', id, customer.id, name, revision), audit(who(c.actor), 'time-project.create', 'time-project', id, { customerId: customer.id, name })])
  return { id, customer_id: customer.id, name, revision }
} }
const save: Command = { need: 'record', async run(c, b) {
  // Monetary fields are refused, not silently ignored by the time-only door.
  requireThat(!Object.keys(b).some(k => /rate|amount|price|cents/i.test(k)), 'Time records contain hours, never rates or amounts', 403)
  const people = await timePeople(c), person = text(b.personEmail ?? c.actor.email, 'Person').toLowerCase()
  requireThat(people.some(p => p.email === person), 'You may record time only for yourself or people the owner named', 403)
  const customerId = text(b.customerId, 'Customer'), projectId = text(b.projectId, 'Project'), itemId = text(b.itemId, 'Service item')
  requireThat(await one(c.db, "SELECT 1 FROM pt_contacts WHERE id = ? AND kind = 'customer' AND active = 1 AND erased_at IS NULL", customerId), 'Choose an active customer')
  const project = await one(c.db, 'SELECT * FROM pt_time_projects WHERE id = ? AND customer_id = ? AND active = 1', projectId, customerId)
  const item = await one(c.db, "SELECT id, revision FROM pt_items WHERE id = ? AND kind = 'service' AND active = 1", itemId)
  requireThat(project && item, 'Choose a project of this customer and an active service item')
  const hours = String(b.hours ?? '')
  requireThat(/^\d+(\.\d{1,2})?$/.test(hours) && Number(hours) > 0 && Number(hours) <= 24, 'Hours must be greater than zero and no more than 24')
  const minutes = Math.round(Number(hours) * 60)
  requireThat(minutes > 0, 'Record at least one minute')
  const id = b.id ? text(b.id, 'Time entry') : uid(), revision = uid(), workDate = date(b.date, 'Work date'), note = optionalText(b.note, 'Note', 500)
  const before = b.id ? await one(c.db, 'SELECT * FROM pt_time_entries WHERE id = ?', id) : null
  if (b.id) requireThat(before && people.some(p => p.email === before.person_email) && before.revision === b.revision && !before.invoice_id, 'Time changed or is already on an invoice; reload', 409)
  const after = { person_email: person, customer_id: customerId, project_id: projectId, item_id: itemId, work_date: workDate, minutes, note, revision }
  await run(c.db, [authority(c.actor, 'record'), guard('EXISTS (SELECT 1 FROM pt_time_projects WHERE id = ? AND revision = ? AND active = 1)', project.id, project.revision), guard('EXISTS (SELECT 1 FROM pt_items WHERE id = ? AND revision = ? AND active = 1)', item.id, item.revision),
    ...(before ? [q('UPDATE pt_time_entries SET person_email = ?, customer_id = ?, project_id = ?, item_id = ?, work_date = ?, minutes = ?, note = ?, revision = ? WHERE id = ? AND revision = ? AND invoice_id IS NULL', person, customerId, projectId, itemId, workDate, minutes, note, revision, id, before.revision), changed()] : [q('INSERT INTO pt_time_entries(id,person_email,recorded_by,customer_id,project_id,item_id,work_date,minutes,note,revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, person, c.actor.email, customerId, projectId, itemId, workDate, minutes, note, revision, now())]),
    audit(who(c.actor), before ? 'time.edit' : 'time.record', 'time', id, { before, after })])
  return { id, ...after }
} }
export const timeCommands = { 'time.save': save, 'time-project.save': projectSave }
