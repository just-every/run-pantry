import { requireThat, text } from '../core'
import { all, one } from '../db'
import type { Context } from '../context'
import { statementAuthority } from './access'

export const statementHref = (id: string) => `/api/pantry/statements/${encodeURIComponent(id)}/document`

export async function statementHistory(db: D1Database, customerId: string) {
  const [statements, deliveries] = await Promise.all([
    all(db, 'SELECT id,mode,from_date,to_date,created_at,created_by,snapshot_json,sha256,subject FROM pt_customer_statements WHERE customer_id=? ORDER BY created_at DESC,id', customerId),
    all(db, `SELECT d.* FROM pt_customer_statement_deliveries d JOIN pt_customer_statements s ON s.id=d.statement_id WHERE s.customer_id=? ORDER BY d.at DESC,d.id`, customerId),
  ])
  return statements.map(s => {
    const snapshot = JSON.parse(s.snapshot_json), href = statementHref(s.id)
    return { id: s.id, kind: 'statement', mode: s.mode, from: s.from_date, to: s.to_date, as_of: s.to_date,
      date: s.to_date, created_at: s.created_at, created_by: s.created_by, subject: s.subject, reference: s.subject,
      opening_balance_cents: snapshot.opening_balance_cents, closing_balance_cents: snapshot.closing_balance_cents,
      sha256: s.sha256, href, document_href: href,
      deliveries: deliveries.filter(d => d.statement_id === s.id).map(d => ({ ...d, kind: 'statement', href })) }
  })
}

export async function statement(c: Context, rawId: string) {
  await statementAuthority(c)
  const id = text(rawId, 'Statement', 100)
  const row = await one(c.db, 'SELECT * FROM pt_customer_statements WHERE id=?', id)
  requireThat(row, 'Statement not found', 404)
  const deliveries = await all(c.db, 'SELECT * FROM pt_customer_statement_deliveries WHERE statement_id=? ORDER BY at,id', id)
  await statementAuthority(c)
  const href = statementHref(id)
  return { ...JSON.parse(row.snapshot_json), id, created_at: row.created_at, created_by: row.created_by,
    subject: row.subject, text: row.text_body, html: row.html_body, sha256: row.sha256,
    href, document_href: href, deliveries: deliveries.map(d => ({ ...d, kind: 'statement', href })) }
}
