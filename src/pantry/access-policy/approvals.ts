// Amount ceilings reduce a posting grant; they never create one. Existing
// second-person rules stay with each document's native approval path.
import { authority, must, type Actor } from '../access'
import { requireThat } from '../core'
import { nativePerson } from './banks'
import { guard, type AuditActor, type Sql } from '../db'

export type ApprovalKind = 'bill' | 'payment' | 'journal'
export function approvalAuthority(actor: Actor, kind: ApprovalKind, amount: number, need: 'post' | 'record' = kind === 'journal' ? 'post' : 'record'): Sql[] {
  must(actor, need)
  requireThat(actor.kind === 'person', 'A person must approve', 403)
  if (actor.role === 'owner') return [authority(actor, need)]
  requireThat(['bookkeeper', 'accountant'].includes(actor.role) || actor.role === 'payables-clerk' && kind === 'bill', 'Approving this record is not part of your role', 403)
  const limit = actor.policy?.[`${kind}Limit`]
  requireThat(limit === null || limit === undefined || amount <= limit, 'This amount exceeds your approval limit; route to the owner for approval', 403)
  const column = `${kind}_limit_cents`
  return [authority(actor, need), guard(`EXISTS (SELECT 1 FROM pt_members WHERE email = ? AND (${column} IS NULL OR ${column} >= ?))`, actor.email, amount)]
}

export function approvalRoute(actor: Actor, kind: ApprovalKind, amount: number) {
  if (actor.kind !== 'person' || actor.role === 'owner') return null
  const limit = actor.policy?.[`${kind}Limit`]
  return (kind === 'payment' && actor.role === 'payables-clerk') || (limit !== null && limit !== undefined && amount > limit) ? 'owner' : null
}

/** Shared posting builders also serve provider and integration principals. */
export function nativeApprovalAuthority(actor: Actor | AuditActor, kind: ApprovalKind, amount: number, need?: 'post' | 'record') {
  return nativePerson(actor) ? approvalAuthority(actor, kind, amount, need) : []
}
