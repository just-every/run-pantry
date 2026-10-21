// Time keeps its financial support (hours, dates, service and invoice links).
// Identity and personal notes use the same erasure marker as native history;
// delegation loses the erased identity rather than granting its replacement.
import { all, changed, q, type Sql } from '../db'
import { uid, type Data } from '../core'
import { scrub } from './personal'

type TimeErasure = { id: string; member: boolean; memberEmail?: string; values: string[]; marker: string }
export async function timeCopies(db: D1Database, input: TimeErasure) {
  const statements: Sql[] = [], counts: Record<string, Data> = {}, affectedRecordIds: string[] = []
  const aliases = new Set(input.memberEmail ? [input.memberEmail, ...input.values.filter(v => /^[^@\s]+@[^@\s]+$/.test(v))].map(v => v.toLowerCase()) : [])
  const count = (table: string, field: string, n = 1) => { counts[table] ??= {}; counts[table][field] = (counts[table][field] ?? 0) + n }
  for (const row of await all(db, 'SELECT id,person_email,recorded_by,customer_id,invoice_id,note,revision FROM pt_time_entries')) {
    const ownContact = !input.member && row.customer_id === input.id
    const set: Data = { note: ownContact && row.note ? input.marker : scrub(row.note, input.values, input.marker) }
    if (aliases.has(row.person_email.toLowerCase())) set.person_email = input.marker
    if (aliases.has(row.recorded_by.toLowerCase())) set.recorded_by = input.marker
    const fields = Object.keys(set).filter(k => set[k] !== row[k])
    if (ownContact && row.invoice_id) count('pt_time_entries', 'rowsRetained')
    if (!fields.length) continue
    statements.push(q(`UPDATE pt_time_entries SET ${fields.map(k => `${k}=?`).join(',')},revision=? WHERE id=? AND revision=? AND invoice_id IS ? AND person_email=? AND recorded_by=? AND note=?`,
      ...fields.map(k => set[k]), uid(), row.id, row.revision, row.invoice_id, row.person_email, row.recorded_by, row.note), changed())
    count('pt_time_entries', 'rowsReplaced'); count('pt_time_entries', 'fieldsReplaced', fields.length); affectedRecordIds.push(row.id)
  }
  for (const row of await all(db, 'SELECT id,customer_id,name,active,revision FROM pt_time_projects')) {
    const name = scrub(row.name, input.values, input.marker) as string
    const active = !input.member && row.customer_id === input.id ? 0 : row.active
    if (name === row.name && active === row.active) continue
    statements.push(q('UPDATE pt_time_projects SET name=?,active=?,revision=? WHERE id=? AND revision=? AND name=? AND active=?', name === row.name ? name : `${name}:${row.id}`, active, uid(), row.id, row.revision, row.name, row.active), changed())
    count('pt_time_projects', 'rowsReplaced'); count('pt_time_projects', 'fieldsReplaced', (name !== row.name ? 1 : 0) + (active !== row.active ? 1 : 0)); affectedRecordIds.push(row.id)
  }
  if (input.memberEmail) for (const row of await all(db, 'SELECT email,time_people,revision FROM pt_members WHERE email<>?', input.memberEmail)) {
    const before = JSON.parse(row.time_people) as string[], after = before.filter(email => !aliases.has(email.toLowerCase()))
    if (after.length === before.length) continue
    statements.push(q('UPDATE pt_members SET time_people=?,revision=? WHERE email=? AND time_people=? AND revision=?', JSON.stringify(after), uid(), row.email, row.time_people, row.revision), changed())
    count('pt_members', 'rowsReplaced'); count('pt_members', 'fieldsReplaced'); count('pt_members', 'delegationsRemoved', before.length - after.length)
  }
  return { statements, counts, affectedRecordIds }
}

export async function unbilledTime(db: D1Database, contactId: string) {
  return (await all(db, 'SELECT id FROM pt_time_entries WHERE customer_id=? AND invoice_id IS NULL ORDER BY id', contactId))
    .map(row => ({ kind: 'time', id: row.id, reason: 'unbilled service hours' }))
}
