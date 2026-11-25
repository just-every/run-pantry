// The test Worker plus one extra door, /__budget, that runs the half-hourly Cron tick or an ordinary
// request's due work against a D1 whose every statement is counted by the rows it reads and writes.
import worker from './worker'
import { runScheduled } from '../../src/pantry/scheduled'
import { runDueWork } from '../../src/pantry/due'

type Total = { reads: number; writes: number; statements: number; unmetered: number; heaviest: Record<string, number> }
function metered(db: D1Database, total: Total) {
  const count = (sql: string, meta?: { rows_read?: number; rows_written?: number }) => {
    total.statements++; if (meta?.rows_read === undefined) total.unmetered++
    total.reads += meta?.rows_read ?? 0; total.writes += meta?.rows_written ?? 0
    const key = sql.replace(/\s+/g, ' ').slice(0, 120); total.heaviest[key] = (total.heaviest[key] ?? 0) + (meta?.rows_read ?? 0)
  }
  const wrap = (inner: D1PreparedStatement, sql: string): any => ({
    inner, sql,
    bind: (...values: unknown[]) => wrap(inner.bind(...values), sql),
    async run() { const r = await inner.run(); count(sql, r.meta); return r },
    async all() { const r = await inner.all(); count(sql, r.meta); return r },
    async first(column?: string) { const r = await inner.all(); count(sql, r.meta); const row = (r.results[0] ?? null) as Record<string, unknown> | null; return column && row ? row[column] : row },
    raw: (options?: any) => inner.raw(options),
  })
  return {
    prepare: (sql: string) => wrap(db.prepare(sql), sql),
    async batch(statements: any[]) { const results = await db.batch(statements.map(s => s.inner)); results.forEach((r, i) => count(statements[i].sql, r.meta)); return results },
    exec: (sql: string) => db.exec(sql),
  } as unknown as D1Database
}

export default {
  ...worker,
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url)
    if (url.pathname !== '/__budget') return worker.fetch(request, env, ctx)
    const total: Total = { reads: 0, writes: 0, statements: 0, unmetered: 0, heaviest: {} }
    const counted = { ...env, DB: metered(env.DB, total) }
    if (url.searchParams.get('door') === 'request') {
      await env.DB.prepare("UPDATE pt_due_work SET started_at = '1970-01-01T00:00:00.000Z'").run()
      await runDueWork(counted)
    } else await runScheduled({ cron: '*/30 * * * *', scheduledTime: Date.now() }, counted)
    return Response.json({ ...total, heaviest: Object.entries(total.heaviest).sort((a, b) => b[1] - a[1]).slice(0, 4) })
  },
}
