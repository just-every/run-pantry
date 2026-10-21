import type { Hono, Context as HttpContext } from 'hono'
import type { Bindings } from '../../../auth.server'
import { authority, type Integration } from '../../access'
import { requireThat, type Data } from '../../core'
import { all, run } from '../../db'

export type ResourceEnv = { Bindings: Bindings; Variables: { integration: Integration & { scopes: string[] } } }
export type ResourceContext = HttpContext<ResourceEnv>
export type Resource = {
  path: string; scope: string; table: string; fields: string; filters: Record<string, string>
  description: string; where?: string; project?: (row: Data) => Data
}

/** Every table, expression, field and filter below is authored in this registry, never supplied by HTTP. */
export function resource(path: string, scope: string, table: string, fields: string, filters: Record<string, string>, description: string, options: Partial<Pick<Resource, 'where' | 'project'>> = {}): Resource {
  return { path, scope, table, fields, filters: { id: 'id', ...filters }, description, ...options }
}
export function pick(row: Data, fields: string): Data {
  return Object.fromEntries(fields.split(',').map(k => k.trim()).filter(k => row[k] !== undefined).map(k => [k, row[k]]))
}
export function decoded(value: unknown): any {
  return typeof value === 'string' ? JSON.parse(value) : value
}
export function jsonFields(fields: Record<string, string | null>) {
  return (row: Data): Data => {
    for (const [key, allowed] of Object.entries(fields)) {
      const value = decoded(row[key])
      row[key] = allowed === null || value == null ? value : Array.isArray(value) ? value.map(v => pick(v, allowed)) : pick(value, allowed)
    }
    return row
  }
}

export async function authorizeRead(c: ResourceContext, scopes: string[]) {
  const credential = c.get('integration'), scope = scopes.find(s => credential.scopes.includes(s))
  requireThat(scope, `This credential needs ${scopes.join(' or ')}`, 403)
  await run(c.env.DB, [authority({ ...credential, scope }, 'read')])
}

export function registerResources(app: Hono<ResourceEnv>, resources: Resource[]) {
  for (const spec of resources) {
    // SELECT * here sees only the explicitly projected subquery, never a native row.
    const source = `(SELECT ${spec.fields} FROM ${spec.table}${spec.where ? ` WHERE ${spec.where}` : ''}) records`
    app.get('/' + spec.path, async c => {
      await authorizeRead(c, [spec.scope])
      const raw = c.req.query('limit') ?? '100', limit = Number(raw)
      requireThat(/^\d+$/.test(raw) && limit >= 1 && limit <= 100, 'limit is 1–100')
      const allowed = new Set(['limit', 'cursor', ...Object.keys(spec.filters)])
      requireThat(Object.keys(c.req.query()).every(k => allowed.has(k)), 'Unknown filter; use the documented exact filters')
      const clauses = ['id > ?'], params: unknown[] = [c.req.query('cursor') ?? '']
      for (const [name, field] of Object.entries(spec.filters)) if (c.req.query(name) !== undefined) {
        clauses.push(`${field} = ?`); params.push(c.req.query(name))
      }
      const rows = await all(c.env.DB, `SELECT * FROM ${source} WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT ?`, ...params, limit + 1)
      const more = rows.length > limit
      if (more) rows.pop()
      return c.json({ records: rows.map(row => spec.project ? spec.project(row) : row), nextCursor: more ? rows.at(-1)!.id : null })
    })
    app.get('/' + spec.path + '/:id', async c => {
      await authorizeRead(c, [spec.scope])
      const rows = await all(c.env.DB, `SELECT * FROM ${source} WHERE id = ?`, c.req.param('id'))
      requireThat(rows.length, 'Record not found', 404)
      return c.json(spec.project ? spec.project(rows[0]) : rows[0])
    })
  }
}
