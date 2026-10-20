import { authority, who } from '../access'
import type { Command, Context } from '../context'
import { now, optionalText, requireThat, text, uid, type Data } from '../core'
import { audit, changed, guard, q, run } from '../db'
import { calculateCustomReport, validateCustomReportDefinition } from './calculate'
import { reportFence, reportPerson, reportTables, savedReport, SHARE_ROLES, type SavedKind } from './store'

function shares(value: unknown) {
  if (value === undefined) return []
  requireThat(Array.isArray(value) && value.length <= SHARE_ROLES.length && value.every(role => SHARE_ROLES.includes(role)), 'Share with existing Pantry roles only')
  return [...new Set(value)]
}

async function save(c: Context, b: Data, kind: SavedKind, definition: Data, references: Data[] = []) {
  const actor = reportPerson(c, 'record'), before = b.id ? await savedReport(c, text(b.id, 'Saved report', 100), kind) : null
  if (before) {
    requireThat(before.can_edit, kind === 'report' ? 'Report not found' : 'Management package not found', 404)
    requireThat(before.revision === b.revision, 'Saved definition changed; reload', 409)
  }
  const shared = shares(b.sharedRoles ?? b.shared_roles ?? before?.shared_roles), encoded = JSON.stringify(definition)
  requireThat(encoded.length <= 128_000, 'Saved definition is limited to 128,000 characters')
  const id = before?.id ?? uid(), revision = uid(), at = now(), table = reportTables[kind]
  await run(c.db, [authority(actor, 'record'), ...(before ? [reportFence(c, before, kind, true)] : [guard(`(SELECT count(*) FROM ${table}) < 500`)]),
    ...references.map(row => reportFence(c, row)),
    ...(before ? [q(`UPDATE ${table} SET name = ?, definition = ?, shared_roles = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?`, definition.name, encoded, JSON.stringify(shared), revision, at, id, b.revision), changed()]
      : [q(`INSERT INTO ${table} (id,name,definition,revision,created_by,shared_roles,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, id, definition.name, encoded, revision, actor.email, JSON.stringify(shared), at, at)]),
    audit(who(actor), kind === 'report' ? 'custom-report.save' : 'management-package.save', kind === 'report' ? 'custom-report' : 'management-package', id,
      { revision, before, after: { definition, shared_roles: shared, created_by: before?.created_by ?? actor.email, revision } }),
  ])
  return savedReport(c, id, kind)
}

const saveReport: Command = { need: 'record', async run(c, b) {
  reportPerson(c, 'record')
  const { id: _id, ...definition } = validateCustomReportDefinition(b.definition ?? b)
  await calculateCustomReport(c.db, definition)
  return save(c, b, 'report', definition)
} }

const savePackage: Command = { need: 'record', async run(c, b) {
  reportPerson(c, 'record')
  const d = b.definition ?? b
  requireThat(d && typeof d === 'object' && !Array.isArray(d), 'Management package definition is required')
  const name = text(d.name, 'Package name', 160), cover = optionalText(d.cover, 'Cover', 10_000)
  requireThat(Array.isArray(d.reportIds) && d.reportIds.length > 0 && d.reportIds.length <= 30, 'Choose 1–30 reports for this package')
  const reportIds = d.reportIds.map((id: unknown) => text(id, 'Report ID', 100))
  requireThat(new Set(reportIds).size === reportIds.length, 'Choose each report once')
  const input = typeof d.commentary === 'string' ? [d.commentary] : d.commentary ?? []
  requireThat(Array.isArray(input) && input.length <= 50, 'Commentary is limited to 50 paragraphs')
  const commentary = input.map((paragraph: unknown) => optionalText(paragraph, 'Commentary', 10_000))
  const references = await Promise.all(reportIds.map((id: string) => savedReport(c, id)))
  return save(c, b, 'package', { name, cover, commentary, reportIds }, references)
} }

export const customReportCommands: Record<string, Command> = {
  'custom-report.save': saveReport,
  'management-package.save': savePackage,
}
