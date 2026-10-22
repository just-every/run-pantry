import { all, one, q, guard, type Sql } from '../db'
import { sha256, type Data } from '../core'
import { supportingBooks } from './retention-clock'
import { siblingCustodyRows } from '../estimates/siblings/custody'

export type RetentionTable = 'pt_documents' | 'pt_invoice_documents' | 'pt_estimate_documents' | 'pt_estimate_sibling_links' | 'pt_contractor_tax'
export type RetentionItem = { table: RetentionTable; id: string; clock: string; expires: string; action: 'retained'; reason: string; revision: string; sha256?: string }
export const WARNING = 'IRS Publication 583: generally 3 years; employment-tax records 4 years; an omission of more than 25% of income 6 years; bad-debt or worthless-securities claims 7 years; indefinitely if no return was filed. No legal adequacy is asserted.'

export function expiry(clock: string, years: number) {
  const [year, month, day] = clock.slice(0, 10).split('-').map(Number)
  const targetYear = BigInt(year) + BigInt(years), leap = targetYear % 4n === 0n && (targetYear % 100n !== 0n || targetYear % 400n === 0n)
  const finalDay = Math.min(day, [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
  return `${String(targetYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}`
}
export function expired(expires: string, today: string) {
  const a = expires.split('-').map(BigInt), b = today.split('-').map(BigInt)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return true
}
export const itemKey = (item: Pick<RetentionItem, 'table' | 'id'>) => `${item.table}:${item.id}`
export const policy = (db: D1Database) => one<Data>(db, 'SELECT years,revision FROM pt_retention_settings WHERE id=1').then(p => p!)

export async function subjectRetention(db: D1Database, contactId: string, years?: number, sharedBooks?: ReturnType<typeof supportingBooks>) {
  const [books, settings, docs, invoices, tax, estimates, siblings] = await Promise.all([
    sharedBooks ?? supportingBooks(db), policy(db),
    all(db, 'SELECT id,sha256,linked_kind,linked_id,name,note,erased_at FROM pt_documents'),
    all(db, 'SELECT d.invoice_id AS id,d.issued_revision,d.sha256,d.erased_at,i.customer_id FROM pt_invoice_documents d JOIN pt_invoices i ON i.id=d.invoice_id'),
    one(db, 'SELECT contact_id AS id,revision,erased_at FROM pt_contractor_tax WHERE contact_id=?', contactId),
    all(db,"SELECT d.estimate_id||':'||d.revision AS id,d.estimate_id,d.revision,d.sha256,d.erased_at FROM pt_estimate_documents d JOIN pt_estimates e ON e.id=d.estimate_id WHERE e.customer_id=?",contactId),
    siblingCustodyRows(db, contactId),
  ])
  const period = years ?? settings.years, subjectEvents = books.closure(books.contacts.get(contactId) ?? [])
  const items: RetentionItem[] = []
  const valueGuards: Sql[] = []
  const add = async (table: RetentionTable, row: Data, clock: string | null) => {
    if (!clock || row.erased_at) return
    const revision = await sha256(JSON.stringify([table, row, clock]))
    items.push({ table, id: row.id, clock, expires: expiry(clock, period), action: 'retained', reason: 'Supports posted entries; retained until the latest supporting transaction plus the owner’s retention period.', revision, ...(row.sha256 ? { sha256: row.sha256 } : {}) })
  }
  await Promise.all(docs.map(async d => {
    const events = books.documents.get(d.id) ?? new Set<string>()
    const belongs = books.directContacts.get(d.id)?.has(contactId) || [...events].some(id => subjectEvents.has(id))
    if (belongs) {
      await add('pt_documents', d, books.clock(events))
      valueGuards.push(guard('EXISTS(SELECT 1 FROM pt_documents WHERE id=? AND sha256=? AND name=? AND note=? AND erased_at IS ?)', d.id, d.sha256, d.name, d.note, d.erased_at))
    }
  }))
  await Promise.all(invoices.filter(i => i.customer_id === contactId).map(i => add('pt_invoice_documents', i, books.clock(books.record('invoice', i.id)))))
  await Promise.all(estimates.map(e=>add('pt_estimate_documents',e,books.clock(books.record('estimate',e.estimate_id)))))
  await Promise.all(siblings.map(e=>add('pt_estimate_sibling_links',{...e,sha256:e.pdf_sha256??e.proof_sha256},books.clock(books.record('estimate',e.estimate_id)))))
  if (tax) {
    await add('pt_contractor_tax', tax, books.clock(subjectEvents))
    valueGuards.push(guard('EXISTS(SELECT 1 FROM pt_contractor_tax WHERE contact_id=? AND revision=? AND erased_at IS ?)', tax.id, tax.revision, tax.erased_at))
  }
  items.sort((a, b) => itemKey(a).localeCompare(itemKey(b)))
  return { items, guards: [...books.guards, ...valueGuards], settings }
}

export async function retentionItems(db: D1Database, contactId: string) {
  return (await subjectRetention(db, contactId)).items
}

export async function retainStatements(db: D1Database, subjectId: string, erasureId: string): Promise<Sql[]> {
  const { items, guards, settings } = await subjectRetention(db, subjectId)
  return [guard('EXISTS(SELECT 1 FROM pt_retention_settings WHERE id=1 AND revision=?)', settings.revision), ...guards,
    ...items.map(i => q(`INSERT INTO pt_retained_items(table_name,row_id,subject_id,erasure_id,clock,expires,revision)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,row_id) DO UPDATE SET
      clock=MAX(pt_retained_items.clock,excluded.clock),expires=MAX(pt_retained_items.expires,excluded.expires),revision=excluded.revision
      WHERE pt_retained_items.erased_at IS NULL`, i.table, i.id, subjectId, erasureId, i.clock, i.expires, i.revision))]
}

/** Only enrolled evidence appears here; erased values never enter the view. */
export async function retainedState(db: D1Database, years?: number) {
  const [settings, retained] = await Promise.all([policy(db), all(db, 'SELECT * FROM pt_retained_items WHERE erased_at IS NULL ORDER BY table_name,row_id')])
  const bySubject = new Map<string, Awaited<ReturnType<typeof subjectRetention>>>()
  const sharedBooks = retained.length ? supportingBooks(db) : undefined
  await Promise.all([...new Set(retained.map(i => i.subject_id as string))].map(async id => { bySubject.set(id, await subjectRetention(db, id, years ?? settings.years, sharedBooks)) }))
  const items = retained.map(row => {
    const live = bySubject.get(row.subject_id)!.items.find(i => i.table === row.table_name && i.id === row.row_id)
    // Enrollment records the last known financial event even if a later relation is retired.
    const clock = live && live.clock > row.clock ? live.clock : row.clock
    return { table: row.table_name as RetentionTable, id: row.row_id as string, key: `${row.table_name}:${row.row_id}`, clock,
      expires: expiry(clock, years ?? settings.years), revision: live?.revision ?? row.revision, sha256: live?.sha256,
      action: 'retained' as const, reason: 'Supporting records are kept until owner-confirmed retention expiry.', erasureId: row.erasure_id }
  })
  const columns = ['table_name','row_id','subject_id','erasure_id','clock','expires','revision','erased_at']
  const ledger = guard(`(SELECT json_group_array(json_array(${columns.join(',')})) FROM (SELECT ${columns.join(',')} FROM pt_retained_items WHERE erased_at IS NULL ORDER BY table_name,row_id))=?`, JSON.stringify(retained.map(r => columns.map(c => r[c] ?? null))))
  const uniqueGuards = [...new Map([...bySubject.values()].flatMap(s => s.guards).map(s => [s.sql + JSON.stringify(s.params), s])).values()]
  return { settings, retained, items, guards: [ledger, ...uniqueGuards] }
}

export async function erasureView(db: D1Database) {
  const state = await retainedState(db)
  const revision = await stateRevision(state)
  const today = new Date().toISOString().slice(0, 10)
  return { years: state.settings.years, revision, items: state.items, ready: state.items.filter(i => expired(i.expires, today)), warning: state.settings.years < 7 ? WARNING : '' }
}
export const stateRevision = (state: Awaited<ReturnType<typeof retainedState>>) => sha256(JSON.stringify([state.settings.revision, state.items]))
