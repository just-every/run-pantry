// API-001: all authenticated v1 requests share a credential's fixed UTC-minute budget.
// The database clock and one conditional UPSERT arbitrate concurrent Workers.
export const INTEGRATION_REQUESTS_PER_MINUTE = 120

export async function integrationBudget(db: D1Database, credentialId: string) {
  const [clock, admission] = await db.batch<{ seconds?: number; window_start?: number; requests?: number }>([
    db.prepare("SELECT CAST(strftime('%s','now') AS INTEGER) AS seconds"),
    db.prepare(`
    INSERT INTO pt_integration_rate_limits (credential_id,window_start,requests)
    VALUES (?, CAST(strftime('%s','now') AS INTEGER) / 60 * 60, 1)
    ON CONFLICT (credential_id) DO UPDATE SET
      window_start = excluded.window_start,
      requests = CASE WHEN pt_integration_rate_limits.window_start = excluded.window_start
        THEN pt_integration_rate_limits.requests + 1 ELSE 1 END
    WHERE pt_integration_rate_limits.window_start != excluded.window_start
      OR pt_integration_rate_limits.requests < ?
    RETURNING window_start, requests
  `).bind(credentialId, INTEGRATION_REQUESTS_PER_MINUTE),
  ])
  // Snapshot the database clock before admission, in the same atomic batch.
  const result = admission.results[0]
  const seconds = clock.results[0].seconds!
  const reset = (result?.window_start ?? Math.floor(seconds / 60) * 60) + 60
  return { allowed: !!result, limit: INTEGRATION_REQUESTS_PER_MINUTE,
    remaining: result ? INTEGRATION_REQUESTS_PER_MINUTE - result.requests! : 0,
    reset, retryAfter: Math.max(1, reset - seconds) }
}
