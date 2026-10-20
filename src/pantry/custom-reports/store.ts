import { authorityCondition, must, type Person, type Role } from '../access'
import type { Context } from '../context'
import { requireThat, type Data } from '../core'
import { all, guard, one, type Sql } from '../db'
import { calculateCustomReport, validateCustomReportDefinition } from './calculate'

export type SavedKind = 'report' | 'package'
export const reportTables = { report: 'pt_custom_reports', package: 'pt_management_packages' } as const
export const SHARE_ROLES: Role[] = ['owner', 'accountant', 'bookkeeper', 'viewer']

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
  return decode(row)
}

// A reader may be a viewer, so computing this flag must not require record access.
function editableExpression(c: Context): Sql {
  const actor = reportPerson(c), authority = authorityCondition(actor, 'record'), owner = ownerCondition(actor)
  return { sql: `(${authority.sql}) AND (r.created_by = ? OR ${owner.sql})`, params: [...authority.params, actor.email, ...owner.params] }
}

export async function savedReportList(c: Context, kind: SavedKind = 'report') {
  const access = reportAccess(c), edit = editableExpression(c)
  return (await all(c.db, `SELECT r.*, (${edit.sql}) AS can_edit FROM ${reportTables[kind]} r WHERE ${access.sql} ORDER BY lower(r.name), r.id LIMIT 500`, ...edit.params, ...access.params)).map(decode)
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
