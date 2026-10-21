import type { Data } from '../core'
import { all, changed, guard, q, type Sql } from '../db'
import { scrub } from './personal'

type Options = { values: string[]; marker: string; member: boolean; erasureId: string }
type Copy = { table: string; key: string; text: string[]; json: string[] }

/** Visit JSON string values without reserializing numbers or object keys. */
function scrubJson(source: string, values: string[], marker: string): string {
  JSON.parse(source) // Malformed evidence must fail, never silently disappear.
  return source.replace(/"(?:[^"\\]|\\.)*"/g, (token: string, offset: number) => {
    if (/^\s*:/.test(source.slice(offset + token.length))) return token
    const before: string = JSON.parse(token)
    const after = scrub(before, values, marker)
    return after === before ? token : JSON.stringify(after)
  })
}

/** Compile only the declared identity copies; the caller owns the journal and
 * scope cleanup in the same atomic batch. No financial text is included here. */
export async function immutableCopies(db: D1Database, options: Options): Promise<{ statements: Sql[]; counts: Record<string, Data> }> {
  const { marker, member, erasureId } = options
  const values = options.values.filter(value => value.length > 0)
  const copies: Copy[] = [
    { table: 'pt_journal_entries', key: 'id', text: member ? ['prepared_by', 'posted_by'] : [], json: [] },
    { table: 'pt_reconciliation_undos', key: 'id', text: member ? ['undone_by', 'reason'] : ['reason'], json: [] },
    { table: 'pt_voided_reconciliations', key: 'id', text: [], json: ['snapshot'] },
    { table: 'pt_line_suggestion_decisions', key: 'bank_line_id', text: member ? ['actor_email'] : [], json: ['suggestion'] },
    { table: 'pt_matches', key: 'id', text: [], json: ['rule_snapshot'] },
  ]
  const statements: Sql[] = [], counts: Record<string, Data> = {}
  const evidence = await Promise.all(copies.map(async copy => {
    const fields = [...copy.text, ...copy.json]
    const rows = fields.length && values.length ? await all(db, `SELECT ${copy.key},${fields.join(',')} FROM ${copy.table}`) : []
    return { copy, fields, rows }
  }))
  for (const { copy, fields, rows } of evidence) {
    counts[copy.table] = { rowsRedacted: 0, fieldsReplaced: 0 }
    for (const row of rows) {
      const replacements: [string, unknown][] = []
      for (const field of fields) {
        const original = row[field]
        if (original === null) continue
        const replacement = copy.json.includes(field) ? scrubJson(original, values, marker) : scrub(original, values, marker)
        if (replacement !== original) replacements.push([field, replacement])
      }
      if (!replacements.length) continue
      statements.push(
        guard(`EXISTS (SELECT 1 FROM ${copy.table} WHERE ${copy.key}=? AND ${fields.map(field => `${field} IS ?`).join(' AND ')})`, row[copy.key], ...fields.map(field => row[field])),
        q('INSERT INTO pt_erasure_scope (erasure_id,table_name,row_id,operation) VALUES (?,?,?,\'redact\')', erasureId, copy.table, row[copy.key]),
        q(`UPDATE ${copy.table} SET ${replacements.map(([field]) => `${field}=?`).join(',')} WHERE ${copy.key}=?`, ...replacements.map(([, value]) => value), row[copy.key]),
        changed(),
      )
      counts[copy.table].rowsRedacted++
      counts[copy.table].fieldsReplaced += replacements.length
    }
  }
  return { statements, counts }
}
