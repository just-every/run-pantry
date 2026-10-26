import { who } from '../access'
import type { Command } from '../context'
import { cents, now, requireThat, text, uid, type Data } from '../core'
import { audit, changed, guard, one, q, run } from '../db'
import { milliPercent } from '../discounts'
import { ownerSession } from '../erasure/owner'

export async function lateFeePolicy(db: D1Database) {
  const row = await one(db, 'SELECT * FROM pt_late_fee_policy WHERE id=1')
  requireThat(row, 'Late fee policy is unavailable', 409)
  return policyView(row)
}

function policyView(row: Data) {
  return { enabled: !!row.enabled, method: row.method as 'flat' | 'percentage',
    flatCents: row.flat_cents as number | null, flatAmount: row.flat_cents === null ? '' : (row.flat_cents / 100).toFixed(2),
    percentageMilli: row.percentage_milli as number | null, percentage: row.percentage_milli === null ? '' : String(row.percentage_milli / 1000),
    graceDays: row.grace_days as number, incomeAccountId: row.income_account_id as string | null,
    taxCode: row.tax_code as string | null, revision: row.revision as string,
    updatedBy: row.updated_by as string | null, updatedAt: row.updated_at as string | null }
}

export const savePolicy: Command = { need: 'owner', async run(c, b) {
  const ownerGuards = await ownerSession(c)
  const before = await lateFeePolicy(c.db)
  requireThat(before.revision === b.revision, 'Late fee policy changed; reload', 409)
  requireThat(typeof b.enabled === 'boolean', 'Choose whether late fees are enabled')
  requireThat(b.method === 'flat' || b.method === 'percentage', 'Choose a flat amount or percentage')
  const grace = Number(b.graceDays)
  requireThat(b.graceDays !== '' && b.graceDays !== null && b.graceDays !== undefined && Number.isInteger(grace) && grace >= 0 && grace <= 3650, 'Grace days must be a whole number from 0 to 3650')
  const flat = b.method === 'flat' && b.flatAmount !== undefined && b.flatAmount !== '' ? cents(b.flatAmount, 'Flat late fee') : null
  const percentage = b.method === 'percentage' && b.percentage !== undefined && b.percentage !== '' ? milliPercent(b.percentage, 'Late fee percentage') : null
  requireThat(!b.enabled || (b.method === 'flat' ? flat !== null : percentage !== null), 'Choose the late fee amount before enabling the policy')
  const accountId = b.incomeAccountId ? text(b.incomeAccountId, 'Late fee income account') : null
  requireThat(!b.enabled || accountId, 'Choose a late fee income account before enabling the policy')
  if (accountId) requireThat(await one(c.db, "SELECT id FROM pt_accounts WHERE id=? AND active=1 AND type='income'", accountId), 'Choose an active income account')
  const taxCode = b.taxCode ? text(b.taxCode, 'Late fee tax treatment') : null
  if (taxCode && taxCode !== 'exempt') requireThat(await one(c.db, 'SELECT id FROM pt_tax_codes WHERE id=? AND active=1', taxCode), 'Choose an active sales tax code')
  const revision = uid(), at = now()
  const after = policyView({ enabled: b.enabled, method: b.method, flat_cents: flat, percentage_milli: percentage, grace_days: grace, income_account_id: accountId, tax_code: taxCode, revision, updated_by: c.actor.email, updated_at: at })
  await run(c.db, [...ownerGuards,
    ...(accountId ? [guard("EXISTS(SELECT 1 FROM pt_accounts WHERE id=? AND active=1 AND type='income')", accountId)] : []),
    ...(taxCode && taxCode !== 'exempt' ? [guard('EXISTS(SELECT 1 FROM pt_tax_codes WHERE id=? AND active=1)', taxCode)] : []),
    q('UPDATE pt_late_fee_policy SET enabled=?,method=?,flat_cents=?,percentage_milli=?,grace_days=?,income_account_id=?,tax_code=?,revision=?,updated_by=?,updated_at=? WHERE id=1 AND revision=?', b.enabled ? 1 : 0, b.method, flat, percentage, grace, accountId, taxCode, revision, c.actor.email, at, b.revision), changed(),
    audit(who(c.actor), 'late-fee-policy.save', 'late-fee-policy', '1', { before, after, revision })])
  return { policy: after }
} }
