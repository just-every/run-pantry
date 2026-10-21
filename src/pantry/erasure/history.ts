import { all, changed, guard, q, type Sql } from '../db'
import { MARKER, scrub } from './personal'

function valuesChanged(before:unknown,after:unknown):number {
  if(typeof before==='string')return before===after?0:1
  if(before&&typeof before==='object')return Object.entries(before).reduce((n,[k,v])=>n+valuesChanged(v,(after as Record<string,unknown>)[k]),0)
  return 0
}

export async function historyStatements(db: D1Database, values: string[], erasure: string, at: string, member?: {email:string;label:string}) {
  const statements: Sql[] = [], counts: Record<string,number> = {pt_audit:0,pt_approvals:0}
  for (const row of await all(db,'SELECT * FROM pt_audit')) {
    const before = JSON.parse(row.detail), after = scrub(before,values,member?.label ?? MARKER) as Record<string,unknown>
    const actor = member && row.actor_email === member.email ? member.label : row.actor_email
    const subject = member && row.subject_kind === 'member' && row.subject_id === member.email ? member.label : row.subject_id
    if (JSON.stringify(before)===JSON.stringify(after) && actor===row.actor_email && subject===row.subject_id) continue
    const replaced=valuesChanged(before,after)+(actor!==row.actor_email?1:0)+(subject!==row.subject_id?1:0)
    after.erasure = {id:erasure,at,notice:`values removed by erasure ${erasure} on ${at.slice(0,10)}`}
    statements.push(q("INSERT INTO pt_erasure_scope VALUES (?,'pt_audit',?,'redact')",erasure,row.id),
      guard('EXISTS (SELECT 1 FROM pt_audit WHERE id=? AND detail=? AND actor_email=?)',row.id,row.detail,row.actor_email),
      q('UPDATE pt_audit SET detail=?,actor_email=?,subject_id=? WHERE id=?',JSON.stringify(after),actor,subject,row.id),changed())
    counts.pt_audit+=replaced
  }
  for (const row of await all(db,'SELECT * FROM pt_approvals')) {
    const note = scrub(row.note,values,member?.label ?? MARKER) as string
    const actor = member && row.actor_email===member.email ? member.label : row.actor_email
    const subject = member && row.subject_kind==='member' && row.subject_id===member.email ? member.label : row.subject_id
    if (note===row.note && actor===row.actor_email && subject===row.subject_id) continue
    statements.push(q("INSERT INTO pt_erasure_scope VALUES (?,'pt_approvals',?,'redact')",erasure,row.id),
      guard('EXISTS (SELECT 1 FROM pt_approvals WHERE id=? AND note=? AND actor_email=?)',row.id,row.note,row.actor_email),
      q('UPDATE pt_approvals SET note=?,actor_email=?,subject_id=? WHERE id=?',note,actor,subject,row.id),changed())
    counts.pt_approvals+=(note!==row.note?1:0)+(actor!==row.actor_email?1:0)+(subject!==row.subject_id?1:0)
  }
  return {statements,counts}
}
