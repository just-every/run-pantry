// Saved mappings and identity reads are installation data. The import kit owns
// mutations to the records/identity rows; the mapping edit is a separate action.
import { canonicalJson } from '../../modules/import-kit/src/d1/index'
import { authority, who } from '../access'
import { date, now, requireThat, text, type Data } from '../core'
import { all, audit, q, run } from '../db'
import type { Command, Context } from '../context'
import { spreadsheetFile } from './spreadsheet-files'
import { columns, dataset, DATASETS, SHEET_FIELDS, spreadsheetTemplate, suggest, type SheetMappings } from './spreadsheet-schema'
import type { SpreadsheetPackage } from './spreadsheet'

export async function savedSpreadsheetMappings(db: D1Database): Promise<SheetMappings> {
  return Object.fromEntries((await all(db, 'SELECT dataset, columns_json FROM pt_spreadsheet_mappings')).map(r => [r.dataset, JSON.parse(r.columns_json)]))
}
export async function readSpreadsheets(c: Context, b: Data): Promise<SpreadsheetPackage> {
  requireThat(b.files && typeof b.files === 'object' && DATASETS.some(key => b.files[key]), 'Upload at least one spreadsheet')
  const saved = await savedSpreadsheetMappings(c.db), files: SpreadsheetPackage['files'] = {}, sheets: SpreadsheetPackage['spreadsheet']['sheets'] = {}, mappings: SheetMappings = {}
  for (const key of DATASETS) {
    const file = b.files[key]; if (!file) continue
    const parsed = spreadsheetFile(file), map = b.mappings?.[key] !== undefined ? columns(key, b.mappings[key]) : suggest(key, parsed.sheet.headers, saved[key])
    requireThat(Object.values(map).every(header => !header || parsed.sheet.headers.includes(header)), `${key}: a mapped column is absent; edit the mapping`)
    sheets[key] = parsed.sheet; mappings[key] = map
    files[key] = { name: text(file.name, 'File name', 200), content: parsed.content, ...(parsed.base64 ? { base64: parsed.base64 } : {}) }
  }
  files.mapping = { name: 'column-mapping.json', content: canonicalJson(mappings as any) }
  const tables = { dimensionSettings:'pt_dimension_settings',dimensions:'pt_dimensions',dimensionRequired:'pt_account_dimensions',chart: 'pt_accounts', counterparty: 'pt_contacts', item: 'pt_items', invoice: 'pt_invoices', bill: 'pt_bills', bank: 'pt_bank_accounts', cutover: 'pt_cutovers', 'spreadsheet-key': 'pt_spreadsheet_keys', tax: 'pt_tax_codes', entry: 'pt_journal_entries', line: 'pt_journal_lines' }
  const native = Object.fromEntries(await Promise.all(Object.entries(tables).map(async ([kind, table]) => [kind, await all(c.db, `SELECT * FROM ${table}${kind === 'line' ? ' ORDER BY entry_id, line_no' : ''}`)])))
  return { files, banks: Array.isArray(b.banks) ? b.banks : [], cutoverDate: date(b.cutoverDate, 'Cutover date'), spreadsheet: { sheets, mappings, keys: native['spreadsheet-key'], native } }
}

export const spreadsheetCommands: Record<string, Command> = {
  'move-in.spreadsheet.inspect': { need: 'record', async run(c, b) {
    const key = dataset(b.dataset), parsed = spreadsheetFile(b.file), saved = await savedSpreadsheetMappings(c.db)
    return { dataset: key, headers: parsed.sheet.headers, rows: parsed.sheet.rows.length, fields: SHEET_FIELDS[key], mapping: suggest(key, parsed.sheet.headers, saved[key]), saved: saved[key] ?? null }
  } },
  'move-in.spreadsheet.mapping': { need: 'record', async run(c, b) {
    const key = dataset(b.dataset), map = columns(key, b.columns)
    requireThat(Object.values(map).some(Boolean), 'Map at least one column')
    await run(c.db, [authority(c.actor, 'record'), q('INSERT INTO pt_spreadsheet_mappings (dataset, columns_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(dataset) DO UPDATE SET columns_json = excluded.columns_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at', key, canonicalJson(map as any), c.actor.email, now()), audit(who(c.actor), 'move-in.mapping', 'spreadsheet', key, { columns: map })])
    return { dataset: key, columns: map }
  } },
  'move-in.spreadsheet.template': { need: 'record', async run(_c, b) { return spreadsheetTemplate(dataset(b.dataset)) } },
}
