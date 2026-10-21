import { authority, must } from '../access'
import type { Context } from '../context'
import { requireThat } from '../core'
import { guard, one } from '../db'
/** Native owner authority is checked at admission and again in the atomic batch. */
export async function ownerSession(c: Context) {
  must(c.actor,'owner')
  requireThat(c.actor.kind==='person','Owner session required',403)
  const session = await one(c.db,"SELECT kind FROM oa_sessions WHERE id=?",c.actor.session)
  const local = c.env.AUTH_LOCAL==='true' && session?.kind==='dev'
  requireThat(session?.kind==='native' || local,'Use the owner’s native sign-in session',403)
  return [authority(c.actor,'owner'),guard("EXISTS (SELECT 1 FROM oa_sessions WHERE id=? AND (kind='native' OR (kind='dev' AND ?=1)))",c.actor.session,local?1:0)]
}
