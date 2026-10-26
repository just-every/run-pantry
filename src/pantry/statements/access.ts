import { authorityCondition, must } from '../access'
import { assertDoor, limitedBanks } from '../access-policy/doors'
import { requireThat } from '../core'
import { guard, one } from '../db'
import type { Context } from '../context'

export async function statementAuthority(c: Context, sending = false) {
  requireThat(c.actor.kind === 'person', 'A person must access customer statements', 403)
  must(c.actor, sending ? 'record' : 'read')
  requireThat(!limitedBanks(c.actor), 'Customer statements require access to all bank accounts', 403)
  requireThat(['owner', 'bookkeeper', 'accountant', 'viewer', 'sales'].includes(c.actor.role), 'Customer statements are not part of your role', 403)
  await assertDoor(c, '/api/pantry/customers/statement/history')
  const condition = authorityCondition(c.actor, sending ? 'record' : 'read')
  const live = await one(c.db, `SELECT (${condition.sql}) AS allowed`, ...condition.params)
  requireThat(live?.allowed, 'Your access changed; sign in again', 403)
  return guard(condition.sql, ...condition.params)
}
