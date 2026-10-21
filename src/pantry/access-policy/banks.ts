// Native sessions spend only their current bank scope. Standing approvals use
// live role/account predicates, never a person's invoice issuing allowance.
import { authority, type Actor, type Person } from '../access'
import { requireThat } from '../core'
import { all, guard, type AuditActor, type Sql } from '../db'

export function nativePerson(actor: Actor | AuditActor): actor is Person {
  return actor.kind === 'person' && 'role' in actor && 'session' in actor && !!actor.session
}
export function bankAuthority(actor: Actor | AuditActor, bankIds: string[], need: 'record' | 'post' = 'record'): Sql[] {
  if (!nativePerson(actor)) return []
  requireThat(actor.role === 'owner' || ['bookkeeper', 'accountant'].includes(actor.role), 'Banking is not part of your role', 403)
  if (actor.role !== 'owner') {
    requireThat(actor.policy, 'Reload your current access before recording', 403)
    requireThat(actor.policy.bankAccounts === null || bankIds.every(id => actor.policy!.bankAccounts!.includes(id)), 'Bank account is outside your access', 403)
  }
  return [authority(actor, need)]
}
export async function ledgerBankAuthority(db: D1Database, actor: Actor | AuditActor, ledgerIds: string[], need: 'record' | 'post' = 'record') {
  if (!nativePerson(actor)) return []
  const banks = await all(db, 'SELECT id FROM pt_bank_accounts WHERE account_id IN (SELECT value FROM json_each(?))', JSON.stringify(ledgerIds))
  return bankAuthority(actor, banks.map(b => b.id), need)
}

export function standingAuthority(email: string, domain: 'bank' | 'journal' | 'invoice', bankIds: string[] = [], ledgerIds: string[] = []): Sql {
  const roles = domain === 'invoice' ? "('bookkeeper','accountant','sales')" : "('bookkeeper','accountant')"
  return { sql: `EXISTS (SELECT 1 FROM oa_operators o WHERE lower(o.email)=lower(?) AND o.status='active'
    AND (o.role='owner' OR EXISTS (SELECT 1 FROM pt_members m WHERE lower(m.email)=lower(o.email) AND m.active=1 AND m.role IN ${roles}
      ${domain === 'bank' ? '' : 'AND m.can_post=1'}
      AND NOT EXISTS (SELECT 1 FROM pt_bank_accounts b WHERE (b.id IN (SELECT value FROM json_each(?)) OR b.account_id IN (SELECT value FROM json_each(?)))
        AND m.bank_accounts IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(m.bank_accounts) visible WHERE visible.value=b.id)))))`,
    params: [email, JSON.stringify(bankIds), JSON.stringify(ledgerIds)] }
}
export const standingFence = (condition: Sql) => guard(condition.sql, ...condition.params)
