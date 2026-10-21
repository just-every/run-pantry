import { redactionStatements, erasureStatements, invalidateTransfersStatements } from '@runeditrun/rer/modules/portability/journal'
import type { Sql } from '../db'
const sql = (s: any): Sql => ({ sql: s.statement, params: [...s.params] })
/** Journal checkpoints and withdrawn snapshots commit with native erasure. */
export async function fenceStatements(db: D1Database, removed: {table: string; key: Record<string,unknown>}[] = []): Promise<Sql[]> {
  const statements = [...await redactionStatements(db), ...await invalidateTransfersStatements(db)]
  for (const row of removed) statements.push(...await erasureStatements(db,row.table,row.key))
  return statements.map(sql)
}
