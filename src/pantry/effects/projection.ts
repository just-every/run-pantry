// A read-only SQL projection of the exact posting plan. Reports run their usual
// queries against these CTEs; nothing is posted, copied into a temporary database,
// or replaced with estimated report arithmetic.
import { all, type Sql } from '../db'
import { requireThat, type Data } from '../core'

const TABLES = new Set(['pt_journal_entries', 'pt_journal_lines', 'pt_payments', 'pt_allocations', 'pt_invoices', 'pt_invoice_lines', 'pt_vendor_credits', 'pt_vendor_credit_lines'])
const literal = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') { requireThat(Number.isFinite(v), 'Invalid projection amount'); return String(v) }
  requireThat(typeof v === 'string', 'Unsupported projection value')
  return `'${v.replaceAll("'", "''")}'`
}

// Keep string literals intact, including descriptions containing SQL names.
function identifiers(sql: string, names: Map<string, string>) {
  return sql.replace(/'(?:''|[^'])*'|"[^"]+"|\b[a-zA-Z_][a-zA-Z_0-9]*\b/g, token => {
    if (token.startsWith("'")) return token
    return names.get(token.replaceAll('"', '')) ?? token
  })
}
function bound(s: Sql) {
  let i = 0
  const sql = s.sql.replace(/'(?:''|[^'])*'|\?/g, token => token === '?' ? literal(s.params[i++]) : token)
  requireThat(i === s.params.length, 'Posting plan parameters do not match')
  return sql
}
function split(sql: string) {
  const parts: string[] = []; let depth = 0, quoted = false, start = 0
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "'") { if (quoted && sql[i + 1] === "'") { i++; continue }; quoted = !quoted }
    if (quoted) continue
    if (sql[i] === '(') depth++
    if (sql[i] === ')') depth--
    if (sql[i] === ',' && depth === 0) { parts.push(sql.slice(start, i).trim()); start = i + 1 }
  }
  parts.push(sql.slice(start).trim())
  return parts
}

export async function projectedBooks(db: D1Database, statements: Sql[], { unlocked = false } = {}) {
  const names = new Map<string, string>(), ctes: string[] = []
  const schemas = new Map<string, Data[]>()
  const add = (table: string, select: string) => {
    const name = `effects_${ctes.length}`
    ctes.push(`${name} AS (${select})`); names.set(table, name)
  }
  if (unlocked) add('pt_periods', "SELECT * FROM pt_periods WHERE status <> 'locked'")
  for (const statement of statements) {
    const mutation = /^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/i.exec(statement.sql)
    if (!mutation || !TABLES.has(mutation[2])) continue
    const table = mutation[2], sql = bound(statement)
    if (!schemas.has(table)) schemas.set(table, await all(db, `PRAGMA table_info(${table})`))
    const columns = schemas.get(table)!
    const previous = names.get(table) ?? table
    const insert = /^INSERT INTO\s+\w+\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*)\)\s*$/i.exec(sql)
    if (insert) {
      const cols = split(insert[1]), values = split(insert[2])
      requireThat(cols.length === values.length, 'Posting plan columns do not match')
      const value = new Map(cols.map((c, i) => [c, values[i]]))
      add(table, `SELECT * FROM ${previous} UNION ALL SELECT ${columns.map(c => `${identifiers(value.get(c.name) ?? c.dflt_value ?? 'NULL', names)} AS "${c.name}"`).join(', ')}`)
      continue
    }
    const update = /^UPDATE\s+\w+\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i.exec(sql)
    requireThat(update, `This posting plan cannot yet be previewed (${table})`)
    const values = new Map(split(update[1]).map(part => { const m = /^(\w+)\s*=\s*([\s\S]+)$/.exec(part); requireThat(m, 'Unsupported posting assignment'); return [m[1], m[2]] }))
    const condition = identifiers(update[2], names)
    add(table, `SELECT ${columns.map(c => values.has(c.name) ? `CASE WHEN ${condition} THEN ${identifiers(values.get(c.name)!, names)} ELSE "${c.name}" END AS "${c.name}"` : `"${c.name}"`).join(', ')} FROM ${previous}`)
  }
  const projected = {
    prepare(sql: string) {
      requireThat(/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql), 'An effects projection is read-only')
      const rewritten = identifiers(sql, names)
      return db.prepare(ctes.length ? `WITH ${ctes.join(', ')} ${/^\s*WITH\b/i.test(rewritten) ? ', ' + rewritten.replace(/^\s*WITH\s+/i, '') : rewritten}` : rewritten)
    },
  } as D1Database
  return projected
}
