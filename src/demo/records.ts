// Fixed identities make a repeated seed harmless, including after a partial start.
export const demoId = (name: string) => `demo-${name}`
export function records(db: D1Database) {
  const statements: D1PreparedStatement[] = []
  return {
    add(table: string, row: Record<string, unknown>) {
      const keys = Object.keys(row), identity = 'id' in row ? 'id' : 'email' in row ? 'email' : 'singleton'
      statements.push(db.prepare(`INSERT INTO ${table} (${keys.join(',')}) SELECT ${keys.map(() => '?').join(',')} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${identity} = ?) ON CONFLICT DO NOTHING`).bind(...Object.values(row), row[identity]))
    },
    sql(sql: string, ...values: unknown[]) { statements.push(db.prepare(sql).bind(...values)) },
    async save() { for (let i = 0; i < statements.length; i += 80) await db.batch(statements.slice(i, i + 80)) },
  }
}
