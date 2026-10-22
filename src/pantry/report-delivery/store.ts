import { authorityCondition, must } from '../access'
import type { Context } from '../context'
import { all, one, guard } from '../db'
import { requireThat } from '../core'
import type { Schedule } from './types'
export const recipientSql = `SELECT lower(email) AS email, name, 'member:'||revision AS scope FROM pt_members WHERE active=1
 UNION ALL SELECT lower(email),name,'contact:'||id||':'||revision FROM pt_contacts WHERE active=1 AND email<>''
 UNION ALL SELECT lower(json_extract(j.value,'$.email')),COALESCE(json_extract(j.value,'$.name'),c.name),'contact:'||c.id||':'||c.revision FROM pt_contacts c,json_each(c.contacts_json) j WHERE c.active=1 AND COALESCE(json_extract(j.value,'$.email'),'')<>''
 UNION ALL SELECT lower(email),display_name,'owner:'||id||':'||version FROM oa_operators WHERE status='active' AND role='owner'
 UNION ALL SELECT email,email,'outside:'||revision FROM pt_report_allowlist WHERE active=1`
export const recipientCondition = (email: string, scope: string) => ({ sql:`EXISTS(SELECT 1 FROM (${recipientSql}) WHERE email=? AND scope=?)`, params:[email,scope] })
export async function recipient(db: D1Database, email: string) {
  return one<{email:string;name:string;scope:string}>(db, `SELECT * FROM (${recipientSql}) WHERE email=? LIMIT 1`, email)
}
export async function assertOwner(c: Context) {
  must(c.actor,'owner')
  const condition = authorityCondition(c.actor,'owner')
  requireThat(await one(c.db,`SELECT 1 WHERE ${condition.sql}`,...condition.params),'Owner access changed; sign in again',403)
}
export async function deliverySettings(c: Context) {
  await assertOwner(c)
  const [schedules,allowlist,recipients,history] = await Promise.all([
    all<Schedule>(c.db,'SELECT * FROM pt_report_schedules ORDER BY name,id'),
    all(c.db,'SELECT * FROM pt_report_allowlist ORDER BY email'),
    all(c.db,`SELECT * FROM (${recipientSql}) ORDER BY email`),
    all(c.db,`SELECT id,schedule_id,schedule_revision,occurrence,due,recipient,name,filename,content_type,sha256,from_date,to_date,basis,status,detail,provider,provider_message_id,claimed_at,finished_at FROM pt_report_deliveries ORDER BY claimed_at DESC,rowid DESC LIMIT 500`),
  ])
  await assertOwner(c)
  return { schedules:schedules.map(s=>({...s,selection:JSON.parse(s.selection),recipients:JSON.parse(s.recipients),active:!!s.active,consent:!!s.consent})),allowlist,recipients,history }
}
export const ATTACHMENT_PART_BYTES = 1_000_000
export const MAX_ATTACHMENT_BYTES = 25_000_000
export async function attachmentHash(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),b=>b.toString(16).padStart(2,'0')).join('')
}
/** Internal immutable readback shared by the owner download and the mail sender. */
export async function retainedAttachment(db: D1Database,id: string) {
  const row = await one(db,"SELECT bytes,byte_size,part_count,filename,content_type,sha256 FROM pt_report_deliveries WHERE id=? AND byte_size>0 AND sha256<>''",id)
  requireThat(row,'Delivery attachment not found',404)
  const size=Number(row.byte_size),count=Number(row.part_count),inline=new Uint8Array(row.bytes)
  requireThat(size<=MAX_ATTACHMENT_BYTES&&/^[a-f0-9]{64}$/.test(row.sha256),'Retained attachment metadata is invalid',409)
  let bytes:Uint8Array
  if(count===0){
    requireThat(size===inline.length&&size<=ATTACHMENT_PART_BYTES,'Retained attachment bytes are incomplete',409)
    bytes=inline
  }else{
    requireThat(inline.length===0&&count===Math.ceil(size/ATTACHMENT_PART_BYTES),'Retained attachment parts are incomplete',409)
    const parts=await all<{part:number;content:ArrayBuffer}>(db,'SELECT part,content FROM pt_report_attachment_parts WHERE delivery_id=? ORDER BY part',id)
    requireThat(parts.length===count,'Retained attachment parts are incomplete',409)
    bytes=new Uint8Array(size)
    let offset=0
    for(let i=0;i<parts.length;i++){
      const part=parts[i],content=new Uint8Array(part.content),expected=Math.min(ATTACHMENT_PART_BYTES,size-offset)
      requireThat(part.part===i&&content.length===expected,'Retained attachment parts are incomplete',409)
      bytes.set(content,offset);offset+=content.length
    }
    requireThat(offset===size,'Retained attachment bytes are incomplete',409)
  }
  requireThat(await attachmentHash(bytes)===row.sha256,'Retained attachment integrity check failed',409)
  return {bytes,filename:row.filename as string,contentType:row.content_type as string,sha256:row.sha256 as string}
}
export async function deliveryAttachment(c: Context,id: string) {
  await assertOwner(c)
  const attachment=await retainedAttachment(c.db,id)
  await assertOwner(c)
  return attachment
}
export const recipientGuard = (email:string,scope:string) => {const g=recipientCondition(email,scope);return guard(g.sql,...g.params)}
