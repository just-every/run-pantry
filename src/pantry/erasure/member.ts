import { all, changed, guard, q, type Sql } from '../db'
import {now,type Data} from '../core'
import {scrub} from './personal'
/** Opaque operator IDs remain for immutable bookkeeping references, without a sign-in identity. */
export async function memberStatements(db: D1Database, subject: Data, label: string) {
  const counts:Record<string,Data>={}
  const statements: Sql[] = [guard('EXISTS (SELECT 1 FROM pt_members WHERE email=? AND active=0 AND revision=?)',subject.email,subject.revision)]
  const operators = await all(db,"SELECT id FROM oa_operators WHERE email=? AND role<>'owner'",subject.email)
  const tables = new Set((await all(db,"SELECT name FROM sqlite_master WHERE type='table'")).map(t=>t.name))
  for (const op of operators) {
    for(const table of ['oa_sessions','oa_tokens','oa_credentials','oa_external_identities','oa_step_up_challenges','oa_owner_signins'])if(tables.has(table)){const n=(await all(db,`SELECT count(*) AS n FROM ${table} WHERE operator_id=?`,op.id))[0].n;counts[table]={rowsRemoved:(counts[table]?.rowsRemoved??0)+n}}
    for (const table of ['oa_provider_sessions','oa_provider_session_pins']) if (tables.has(table)) statements.push(q(`DELETE FROM ${table} WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?)`,op.id))
    statements.push(q("DELETE FROM oa_dev_credentials WHERE id IN (SELECT id FROM oa_sessions WHERE operator_id=? UNION SELECT id FROM oa_tokens WHERE operator_id=? UNION SELECT id FROM oa_credentials WHERE operator_id=?)",op.id,op.id,op.id))
    for (const table of ['oa_step_up_challenges','oa_external_identities','oa_credentials','oa_owner_signins']) if (tables.has(table)) statements.push(q(`DELETE FROM ${table} WHERE operator_id=?`,op.id))
    statements.push(q('DELETE FROM oa_sessions WHERE operator_id=?',op.id),q('DELETE FROM oa_tokens WHERE operator_id=?',op.id),
      q("UPDATE oa_operators SET email=?,display_name=?,status='inactive',version=version+1 WHERE id=? AND role<>'owner'",label,label,op.id),changed())
  }
  if(tables.has('oa_auth_audit'))for(const row of await all(db,'SELECT id,value FROM oa_auth_audit')){const value=scrub(row.value,[subject.email,subject.name],label);if(value!==row.value){statements.push(q('UPDATE oa_auth_audit SET value=? WHERE id=? AND value=?',value,row.id,row.value),changed());counts.oa_auth_audit={fieldsReplaced:(counts.oa_auth_audit?.fieldsReplaced??0)+1}}}
  statements.push(q("UPDATE pt_members SET email=?,name=?,revision=?,erased_at=? WHERE email=? AND active=0",label,label,crypto.randomUUID(),now(),subject.email),changed())
  return {statements,operators:operators.length,counts}
}
