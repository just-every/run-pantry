// Owner-set limits authorize only a person's own exact revision; posting grants stay separate.
import { authority, must, who, type Actor } from './access'
import { cents, now, requireThat, text, uid, type Data } from './core'
import { all, audit, guard, one, q, run, type Sql } from './db'
import type { Command } from './context'

export async function effectiveLimit(db: D1Database, actor: Actor) {
  if (actor.kind !== 'person' || actor.role === 'owner') return null
  const personId = `person:${actor.email}`, roleId = `role:${actor.role}`
  return await one(db, 'SELECT * FROM pt_issuing_limits WHERE id IN (?, ?) ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1', personId, roleId, personId)
}

export async function withinLimit(db: D1Database, actor: Actor, document: Data, expected: unknown) {
  must(actor, 'post')
  requireThat(actor.kind === 'person' && actor.role !== 'owner' && document.prepared_by === actor.email, 'Only the preparer uses an issuing limit', 403)
  const limit = await effectiveLimit(db, actor)
  requireThat(limit || expected, 'A second person must approve: no self-approval limit is configured', 403)
  requireThat(limit && expected === limit.revision, 'Issuing limit changed; reload before approving', 409)
  const amount = document.kind === 'credit' ? limit.credit_cents : limit.issuing_cents
  requireThat(amount > 0 && document.total_cents <= amount, 'A second person must approve: this document is over the limit or has no limit', 403)
  if (document.kind === 'credit') {
    const target = await one(db, 'SELECT self_approval FROM pt_invoices WHERE id = ?', document.credit_for)
    requireThat(!target?.self_approval || JSON.parse(target.self_approval).person !== actor.email, 'A second person must approve a correction of your self-approved invoice', 403)
  }
  const detail = { label: 'self-approved within limit', person: actor.email, limit: amount, limitId: limit.id, limitRevision: limit.revision, source: limit.id.startsWith('person:') ? 'person' : 'role', at: now() }
  const fences: Sql[] = [authority(actor, 'post'),
    guard('EXISTS (SELECT 1 FROM pt_members WHERE email = ? AND role = ? AND active = 1 AND can_post = 1)', actor.email, actor.role),
    guard('EXISTS (SELECT 1 FROM pt_issuing_limits WHERE id = ? AND revision = ? AND issuing_cents = ? AND credit_cents = ?)', limit.id, limit.revision, limit.issuing_cents, limit.credit_cents)]
  if (limit.id.startsWith('role:')) fences.push(guard('NOT EXISTS (SELECT 1 FROM pt_issuing_limits WHERE id = ?)', `person:${actor.email}`))
  if (document.kind === 'credit') fences.push(guard("NOT EXISTS (SELECT 1 FROM pt_invoices WHERE id = ? AND json_extract(self_approval, '$.person') = ?)", document.credit_for, actor.email))
  const note = `${detail.label}: $${(amount / 100).toFixed(2)} ${detail.source} limit ${detail.limitId}, revision ${detail.limitRevision}`
  return { detail, fences, note }
}

const save: Command = { need: 'owner', async run(c, b) {
  const id = text(b.id, 'Role or person')
  requireThat(['role:bookkeeper', 'role:accountant'].includes(id) || (id.startsWith('person:') && !!await one(c.db, 'SELECT 1 FROM pt_members WHERE email = ?', id.slice(7))), 'Choose a current role or person')
  const before = await one(c.db, 'SELECT * FROM pt_issuing_limits WHERE id = ?', id)
  requireThat((before?.revision ?? null) === (b.revision ?? null), 'Limits changed; reload', 409)
  const after = b.inherit === true ? null : { id, issuing_cents: b.issuing ? cents(b.issuing, 'Issuing limit', { zero: true }) : 0, credit_cents: b.credit ? cents(b.credit, 'Credit limit', { zero: true }) : 0, revision: uid() }
  await run(c.db, [authority(c.actor, 'owner'),
    guard('(SELECT revision FROM pt_issuing_limits WHERE id = ?) IS ?', id, before?.revision ?? null),
    ...(after ? [q('INSERT INTO pt_issuing_limits (id, issuing_cents, credit_cents, revision) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET issuing_cents = excluded.issuing_cents, credit_cents = excluded.credit_cents, revision = excluded.revision', id, after.issuing_cents, after.credit_cents, after.revision)] : [q('DELETE FROM pt_issuing_limits WHERE id = ?', id)]),
    audit(who(c.actor), 'issuing-limit.save', 'issuing-limit', id, { before, after })])
  return { saved: true }
} }
export const issuingLimitCommands = { 'issuing-limit.save': save }
export async function limitsView(db: D1Database, actor: Actor) {
  return { effective: await effectiveLimit(db, actor), rows: actor.kind === 'person' && actor.role === 'owner' ? await all(db, 'SELECT * FROM pt_issuing_limits ORDER BY id') : [] }
}
export async function selfApprovedDocuments(db: D1Database, day: string, person: string) {
  return all(db, "SELECT id, number, kind, total_cents, prepared_by, self_approval FROM pt_invoices WHERE self_approval IS NOT NULL AND substr(json_extract(self_approval, '$.at'), 1, 10) = ? AND (? = '' OR prepared_by = ?) ORDER BY number", day, person, person)
}
