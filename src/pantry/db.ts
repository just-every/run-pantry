// D1 access: every write is one atomic batch. Conditions that must still hold
// when the batch commits (current authority, unchanged revisions, open periods)
// go in as guard rows; one false guard rolls the whole batch back.
import { Fault, longDay, monthName, uid, now, type Data } from './core'

type AuditEvent = { id: string; at: string; actor: AuditActor; action: string; subjectKind: string; subjectId: string; detail: Data }
export type Sql = { sql: string; params: unknown[]; auditEvent?: AuditEvent; auditBefore?: Sql; auditVersion?: Sql }
export const q = (sql: string, ...params: unknown[]): Sql => ({ sql, params })

export const guard = (condition: string, ...params: unknown[]): Sql =>
  q(`INSERT INTO pt_guard SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END`, ...params)

/** The statement just before this one changed exactly `n` rows. */
export const changed = (n = 1) => q(`INSERT INTO pt_guard SELECT CASE WHEN changes() = ${n} THEN 1 ELSE 0 END`)

export function faultFrom(error: unknown): Fault | null {
  const message = String((error as Error)?.message ?? error)
  if (message.includes('PANTRY_PERIOD_LOCKED')) return new Fault(409, 'That date is in a locked period; ask for the period to be reopened first')
  if (message.includes('PANTRY_ADJUSTING_YEAR_END')) return new Fault(409, 'Adjusting entries must be dated at fiscal year end; review the business fiscal year setting')
  if (message.includes('PANTRY_UNBALANCED')) return new Fault(400, 'Entry does not balance: debits must equal credits')
  if (message.includes('PANTRY_POSTED_IMMUTABLE')) return new Fault(409, 'Posted entries cannot change; reverse the entry to correct it')
  if (message.includes('CHECK constraint failed: ok = 1')) return new Fault(409, 'The books or your access changed while you worked; reload and try again')
  if (message.includes('pt_match_bank_line_once') || message.includes('pt_match_bank_lines.bank_line_id')) return new Fault(409, 'A statement line is already matched')
  if (message.includes('pt_match_posting_once') || message.includes('pt_match_postings.journal_line_id')) return new Fault(409, 'A ledger posting is already matched')
  if (message.includes('UNIQUE constraint failed')) return new Fault(409, 'That record already exists: ' + message.replace(/.*UNIQUE constraint failed: /, '').split(':')[0])
  if (message.includes('FOREIGN KEY constraint failed')) return new Fault(409, 'Another record still refers to this one')
  return null
}

export async function run(db: D1Database, statements: Sql[]) {
  try {
    const enriched = await Promise.all(statements.map(s => s.auditEvent ? auditStatement(db, s.auditEvent) : s))
    const events = enriched.filter(s => s.auditEvent)
    const before = events.flatMap(s => s.auditBefore ? [s.auditBefore] : [])
    const writes = enriched.filter(s => !s.auditEvent)
    const history = events.flatMap(s => s.auditVersion ? [s.auditVersion, s] : [s])
    const cleanup = events.filter(s => s.auditBefore).map(s => q('DELETE FROM pt_audit_before WHERE event_id = ?', s.auditEvent!.id))
    return await db.batch([...before, ...writes, ...history, ...cleanup, q('DELETE FROM pt_guard')].map(s => db.prepare(s.sql).bind(...s.params)))
  } catch (error) {
    throw faultFrom(error) ?? error
  }
}

export async function all<T = Data>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results
}

export async function one<T = Data>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return await db.prepare(sql).bind(...params).first<T>()
}

export type AuditActor = { email: string; kind: 'person' | 'agent' | 'system' | 'integration' }

/** Metadata is resolved inside the same batch, after the record write. */
export function audit(actor: AuditActor, action: string, subjectKind: string, subjectId: string, detail: Data = {}): Sql {
  const event = { id: uid(), at: now(), actor, action, subjectKind, subjectId, detail }
  return { ...q('INSERT INTO pt_audit (id, at, actor_email, actor_kind, action, subject_kind, subject_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    event.id, event.at, actor.email, actor.kind, action, subjectKind, subjectId, JSON.stringify(detail)), auditEvent: event }
}

// This maps domain records to their storage, not actions to individual writers.
// Unversioned records receive a stored history revision in the same batch.
const AUDIT_RECORDS: Record<string, [string, string?]> = {
  'recurring-journal': ['pt_recurring_journals'], journal: ['pt_journal_entries'], invoice: ['pt_invoices'], credit: ['pt_invoices'], bill: ['pt_bills'], payment: ['pt_payments'],
  account: ['pt_accounts'], customer: ['pt_contacts'], vendor: ['pt_contacts'], proposal: ['pt_proposals'], member: ['pt_members', 'email'],
  agent: ['pt_agents'], entity: ['pt_entity'], document: ['pt_documents'], statement: ['pt_statements'], period: ['pt_periods'],
  match: ['pt_matches'], 'bank-account': ['pt_bank_accounts'], 'bank-rule': ['pt_bank_rules'], 'receipt-rule': ['pt_receipt_rules'],
  recurring: ['pt_recurring'], receipt: ['pt_receipts'], 'vendor-credit': ['pt_vendor_credits'], 'tax-code': ['pt_tax_codes'],
  exemption: ['pt_exemption_certificates'], integration: ['pt_integrations'], feed: ['pt_feed_items'], stripe: ['pt_stripe'],
  cutover: ['pt_cutovers'], owner: ['oa_operators'], gusto: ['pt_gusto'], question: ['pt_questions'], sending: ['pt_sending'], 'books-agent': ['pt_books_agent'], 'capture-draft': ['pt_capture_drafts'], 'capture-approval-rule': ['pt_capture_approval_rules'],
}
const auditColumns = new WeakMap<D1Database, Map<string, Promise<string[]>>>()
function columnsFor(db: D1Database, table: string) {
  let cache = auditColumns.get(db)
  if (!cache) { cache = new Map(); auditColumns.set(db, cache) }
  if (!cache.has(table)) cache.set(table, all<{ name: string }>(db, `PRAGMA table_info("${table}")`).then(rows => rows.map(r => r.name)))
  return cache.get(table)!
}
function recordSource(kind: string, id: string) {
  return kind === 'settings' ? id === 'ai-reading' ? ['pt_reader'] : id === 'receipt-address' ? ['pt_receipt_inbox'] : null : AUDIT_RECORDS[kind]
}
async function revisionExpression(db: D1Database, kind: string, id: string): Promise<Sql> {
  const source = recordSource(kind, id)
  if (!source) return q('NULL')
  const [table, key = 'id'] = source, columns = await columnsFor(db, table)
  const revision = columns.includes('revision') ? 'revision' : columns.includes('sha256') ? 'sha256' : null
  return revision ? q(`(SELECT "${revision}" FROM "${table}" WHERE "${key}" = ?)`, kind === 'settings' ? '1' : id) : q('NULL')
}
async function snapshotExpression(db: D1Database, kind: string, id: string): Promise<Sql | null> {
  const source = recordSource(kind, id)
  if (!source) return null
  const [table, key = 'id'] = source
  const columns = (await columnsFor(db, table)).filter(c => !/(content|token|key|secret|sealed|password|credential|signature|tin|hash|routing|account_number|endpoint|url)/i.test(c))
  if (!columns.length) return null
  return q(`(SELECT json_object(${columns.map(c => `'${c}', "${c}"`).join(', ')}) FROM "${table}" WHERE "${key}" = ?)`, kind === 'settings' ? '1' : id)
}
async function auditStatement(db: D1Database, e: AuditEvent): Promise<Sql> {
  const d = e.detail, rule = e.action === 'bank-rule.file' ? d.ruleId : e.action === 'receipt.attach-by-rule' ? d.rule : null
  const scheduledJournal = e.actor.email === 'pantry:recurring-journals' ? d.recurringJournal?.id : null
  const authorityKind = rule ? e.action.startsWith('receipt.') ? 'receipt-rule' : 'bank-rule' : e.actor.email === 'pantry:recurring' && e.subjectKind === 'recurring' ? 'recurring' : scheduledJournal ? 'recurring-journal' : null
  const authorityId = rule ?? (authorityKind === 'recurring' ? e.subjectId : scheduledJournal)
  const [revision, authorityRevision] = await Promise.all([revisionExpression(db, e.subjectKind, e.subjectId), authorityId ? revisionExpression(db, authorityKind!, authorityId) : Promise.resolve(q('NULL'))])
  const approvedKind = d.proposal ? 'proposal' : e.subjectKind, approvedId = d.proposal ?? e.subjectId
  const reliesOnApproval = /\.(post|issue|approve|lock|reverse|reopen|run|price-approve)$/.test(e.action)
  const approvalId = !reliesOnApproval ? q('NULL') : e.subjectKind === 'capture-draft'
    ? q("(SELECT a.id FROM pt_approvals a JOIN pt_capture_drafts d ON a.subject_kind = d.kind AND a.subject_id = COALESCE(d.bill_id, d.id) AND a.subject_revision = d.revision WHERE d.id = ? AND a.decision = 'approved' ORDER BY a.at DESC, a.rowid DESC LIMIT 1)", e.subjectId)
    : q("(SELECT id FROM pt_approvals WHERE subject_kind = ? AND subject_id = ? AND decision = 'approved' ORDER BY at DESC, rowid DESC LIMIT 1)", approvedKind, approvedId)
  const origin = rule ? 'rule' : e.actor.email === 'pantry:recurring' || e.actor.email === 'pantry:recurring-journals' || e.actor.email === 'pantry:reminders' ? 'schedule' : e.actor.kind === 'integration' || /^pantry:(stripe|gusto|auto-match)$/.test(e.actor.email) ? 'connection' : e.actor.kind
  const snapshot = !('before' in d || 'after' in d) ? await snapshotExpression(db, e.subjectKind, e.subjectId) : null
  const detailSql = snapshot ? `json_set(?, '$.before', json((SELECT state FROM pt_audit_before WHERE event_id = ?)), '$.after', json(${snapshot.sql}))` : '?'
  const result = q(`INSERT INTO pt_audit (id, at, actor_email, actor_kind, action, subject_kind, subject_id, detail, subject_revision, approval_id, origin_kind, authority_kind, authority_id, authority_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ${detailSql}, COALESCE(${revision.sql}, ?, ?), ${approvalId.sql}, ?, ?, ?, ${authorityRevision.sql})`,
    e.id, e.at, e.actor.email, e.actor.kind, e.action, e.subjectKind, e.subjectId, JSON.stringify(d), ...(snapshot ? [e.id, ...snapshot.params] : []), ...revision.params,
    d.revision ?? d.after?.revision ?? d.before?.revision ?? null, e.id, ...approvalId.params, origin, authorityKind, authorityId, ...authorityRevision.params)
  return { ...result, auditEvent: e, auditVersion: q('INSERT INTO pt_record_revisions (subject_kind, subject_id, revision) VALUES (?, ?, ?) ON CONFLICT (subject_kind, subject_id) DO UPDATE SET revision = excluded.revision', e.subjectKind, e.subjectId, e.id), ...(snapshot ? { auditBefore: q(`INSERT INTO pt_audit_before (event_id, state) VALUES (?, ${snapshot.sql})`, e.id, ...snapshot.params) } : {}) }
}

export const approval = (actor: AuditActor, subjectKind: string, subjectId: string, subjectRevision: string, action: string, decision: 'approved' | 'rejected', note = '') =>
  q('INSERT INTO pt_approvals (id, subject_kind, subject_id, subject_revision, action, decision, actor_email, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    uid(), subjectKind, subjectId, subjectRevision, action, decision, actor.email, note, now())

/** Writes may not land in a locked period; the triggers repeat this for postings. */
export const periodOpen = (day: string) => guard("NOT EXISTS (SELECT 1 FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date)", day)

export async function assertOpen(db: D1Database, day: string) {
  const locked = await one(db, "SELECT id FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", day)
  if (locked) throw new Fault(409, `${longDay(day)} is in ${monthName(locked.id)}, which is locked; ask for the period to be reopened first`)
}
