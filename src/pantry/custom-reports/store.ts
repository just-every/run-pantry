import { authorityCondition, must, type Person, type Role } from '../access'
import { financialSourceAllowed } from '../access-policy/doors'
import type { Context } from '../context'
import { Fault, requireThat, type Data } from '../core'
import { all, guard, one, type Sql } from '../db'
import { calculateCustomReport, validateCustomReportDefinition } from './calculate'

export type SavedKind = 'report' | 'package'
export const reportTables = { report: 'pt_custom_reports', package: 'pt_management_packages' } as const
export const SHARE_ROLES: Role[] = ['owner', 'accountant', 'bookkeeper', 'viewer', 'sales', 'payables-clerk', 'time-only']

export function reportPerson(c: Context, need: 'read' | 'record' = 'read'): Person {
  must(c.actor, need)
  requireThat(c.actor.kind === 'person', 'A signed-in person is required', 403)
  return c.actor
}

const ownerCondition = (actor: Person): Sql => ({
  sql: "EXISTS (SELECT 1 FROM oa_operators owner WHERE owner.id = ? AND owner.role = 'owner' AND owner.status = 'active')",
  params: [actor.id],
})

/** Resolve the live role in SQL, so a share never survives a mid-request role change. */
export function reportAccess(c: Context, alias = 'r', edit = false): Sql {
  const actor = reportPerson(c, edit ? 'record' : 'read')
  const authority = authorityCondition(actor, edit ? 'record' : 'read'), owner = ownerCondition(actor)
  return {
    sql: `(${authority.sql}) AND (${alias}.created_by = ? OR ${owner.sql}${edit ? '' : ` OR EXISTS (SELECT 1 FROM pt_members member JOIN json_each(${alias}.shared_roles) share ON share.value = member.role WHERE member.email = ? AND member.active = 1)`})`,
    params: [...authority.params, actor.email, ...owner.params, ...(edit ? [] : [actor.email])],
  }
}

export async function assertReportRead(c: Context) {
  const actor = reportPerson(c), authority = authorityCondition(actor, 'read')
  requireThat(await one(c.db, `SELECT 1 WHERE ${authority.sql}`, ...authority.params), 'Report not found', 404)
}

function decode(row: Data): Data {
  const { definition, shared_roles, can_edit, ...metadata } = row
  const parsed = JSON.parse(definition)
  return { ...metadata, definition: parsed, shared_roles: JSON.parse(shared_roles), can_edit: !!can_edit,
    ...(Array.isArray(parsed.reportIds) ? { reportIds: parsed.reportIds, cover: parsed.cover, commentary: parsed.commentary } : {}) }
}

export async function savedReport(c: Context, id: string, kind: SavedKind = 'report'): Promise<Data> {
  const access = reportAccess(c), edit = editableExpression(c)
  const row = await one(c.db, `SELECT r.*, (${edit.sql}) AS can_edit FROM ${reportTables[kind]} r WHERE r.id = ? AND ${access.sql}`, ...edit.params, id, ...access.params)
  requireThat(row, kind === 'report' ? 'Report not found' : 'Management package not found', 404)
  const saved = decode(row)
  await assertSavedSources(c, saved, kind)
  return saved
}

/** Source access is independent of authorship and sharing. Packages resolve
 * each constituent with the reader's own share and source authority. */
export function assertDefinitionRead(c: Context, definition: Data) {
  requireThat(financialSourceAllowed(reportPerson(c), definition.source), 'Report not found', 404)
}
async function assertSavedSources(c: Context, saved: Data, kind: SavedKind, references?: Map<string, Promise<Data>>) {
  if (kind === 'report') { assertDefinitionRead(c, saved.definition); return }
  requireThat(Array.isArray(saved.reportIds) && saved.reportIds.length > 0 && saved.reportIds.length <= 30, 'Management package not found', 404)
  try { await Promise.all(saved.reportIds.map((id: string) => {
    if (!references) return savedReport(c, id)
    if (!references.has(id)) references.set(id, savedReport(c, id))
    return references.get(id)!
  })) }
  catch (error) {
    if (error instanceof Fault && error.status === 404) throw new Fault(404, 'Management package not found')
    throw error
  }
  if (!references) await assertReportRead(c)
}

// A reader may be a viewer, so computing this flag must not require record access.
function editableExpression(c: Context): Sql {
  const actor = reportPerson(c), authority = authorityCondition(actor, 'record'), owner = ownerCondition(actor)
  return { sql: `(${authority.sql}) AND (r.created_by = ? OR ${owner.sql})`, params: [...authority.params, actor.email, ...owner.params] }
}

export async function savedReportList(c: Context, kind: SavedKind = 'report') {
  const access = reportAccess(c), edit = editableExpression(c)
  const candidates = await all(c.db, `SELECT r.*, (${edit.sql}) AS can_edit FROM ${reportTables[kind]} r WHERE ${access.sql} ORDER BY lower(r.name), r.id LIMIT 500`, ...edit.params, ...access.params)
  // The same report can belong to many packages. Resolve each shared source
  // once for this list, then recheck the live authority before returning.
  const references = new Map<string, Promise<Data>>()
  const visible = await Promise.all(candidates.map(async row => {
    const saved = decode(row)
    try { await assertSavedSources(c, saved, kind, references); return saved }
    catch (error) { if (error instanceof Fault && error.status === 404) return null; throw error }
  }))
  await assertReportRead(c)
  return visible.filter((row): row is Data => row !== null)
}

/** Used inside the atomic write batch for edits and package references. */
export function reportFence(c: Context, row: Data, kind: SavedKind = 'report', edit = false): Sql {
  const access = reportAccess(c, 'r', edit)
  return guard(`EXISTS (SELECT 1 FROM ${reportTables[kind]} r WHERE r.id = ? AND r.revision = ? AND ${access.sql})`, row.id, row.revision, ...access.params)
}

export async function renderSavedReport(c: Context, id: string) {
  const saved = await savedReport(c, id)
  const report = await calculateCustomReport(c.db, { ...validateCustomReportDefinition(saved.definition), id: saved.id })
  // Recheck current authority and the share after reading financial figures.
  const current = await savedReport(c, id)
  requireThat(current.revision === saved.revision, 'Report changed; reload', 409)
  return { saved: current, report }
}

export async function renderSavedPackage(c: Context, id: string) {
  const saved = await savedReport(c, id, 'package')
  requireThat(Array.isArray(saved.reportIds) && saved.reportIds.length > 0 && saved.reportIds.length <= 30, 'Invalid saved package')
  const reports = []
  for (const reportId of saved.reportIds) reports.push(await renderSavedReport(c, reportId))
  // A package share grants no rights to its constituent reports.
  for (const rendered of reports) {
    const current = await savedReport(c, rendered.saved.id)
    requireThat(current.revision === rendered.saved.revision, 'Report changed; reload', 409)
  }
  const current = await savedReport(c, id, 'package')
  requireThat(current.revision === saved.revision, 'Management package changed; reload', 409)
  return { saved: current, reports }
}
