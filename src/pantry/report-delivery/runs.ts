import { runtimeBindings, type Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { who } from '../access'
import type { Context } from '../context'
import { addDays, monthBounds, now, requireThat, type Data, uid } from '../core'
import { all, audit, changed, guard, one, q, run } from '../db'
import { businessDay } from '../delivery'
import { recordReportIssue } from '../effects/issues'
import { scheduleCondition, standingOwner } from './authority'
import { buildDelivery } from './export'
import { ATTACHMENT_PART_BYTES, MAX_ATTACHMENT_BYTES, attachmentHash, retainedAttachment, recipient, recipientCondition, recipientGuard } from './store'
import type { Delivery, MailResult, Occurrence, Schedule, Selection } from './types'

const booksRevision = async(db:D1Database) => Number((await one(db,'SELECT COALESCE(MAX(rowid),0) AS n FROM pt_audit'))!.n)
/** A calendar date identifies an occurrence even across daylight-saving changes. */
export async function occurrences(db:D1Database,s:Schedule,at:Date):Promise<Occurrence[]> {
  if(s.cadence==='month-lock') {
    const locks=await all(db,`SELECT id,at,subject_id FROM pt_audit a WHERE rowid>? AND action='period.lock' AND subject_kind='period'
      AND NOT EXISTS(SELECT 1 FROM pt_report_deliveries d WHERE d.schedule_id=? AND d.schedule_revision=? AND d.occurrence='lock:'||a.id)
      ORDER BY rowid LIMIT 25`,s.lock_watermark,s.id,s.revision)
    return locks.map(a=>{const range=monthBounds(a.subject_id);return{key:`lock:${a.id}`,from:range.start,to:range.end,due:a.at}})
  }
  const today=businessDay(s.time_zone,at), found:Occurrence[]=[]
  const existing=await all<{occurrence:string}>(db,'SELECT DISTINCT occurrence FROM pt_report_deliveries WHERE schedule_id=? AND schedule_revision=?',s.id,s.revision)
  const done=new Set(existing.map(r=>r.occurrence))
  for(let day=addDays(s.activated_day,1);day<=today;day=addDays(day,1)) {
    const match=s.cadence==='weekly'?new Date(`${day}T00:00:00Z`).getUTCDay()===s.weekday:Number(day.slice(8))===s.month_day
    if(!match)continue
    const key=`${s.cadence}:${day}`
    if(done.has(key))continue
    const range=s.cadence==='weekly'?{start:addDays(day,-7),end:addDays(day,-1)}:monthBounds(addDays(day.slice(0,7)+'-01',-1).slice(0,7))
    found.push({key,from:range.start,to:range.end,due:day})
    if(found.length===25)break
  }
  return found
}
function occurrenceSelection(s:Schedule,o:Occurrence):Selection {
  const selection=JSON.parse(s.selection) as Selection
  if(selection.rangeMode==='occurrence'||!['custom-report','management-package'].includes(selection.kind)) {
    selection.query={...selection.query,from:o.from,to:o.to}
    if(selection.kind==='accountant-package')selection.query.period=o.to.slice(0,7)
    if(selection.report==='contractors')selection.query.year=o.to.slice(0,4)
  }
  return selection
}
async function finish(db:D1Database,id:string,status:string,detail:string,result?:MailResult) {
  await run(db,[q("UPDATE pt_report_deliveries SET status=?,detail=?,provider=?,provider_message_id=?,finished_at=? WHERE id=? AND status IN('claimed','sending')",status,detail,result?.provider??null,result?.providerMessageId??null,now(),id),
    audit({kind:'system',email:'pantry:report-delivery'},'report-delivery.outcome','report-delivery',id,{status,detail,provider:result?.provider??null,providerMessageId:result?.providerMessageId??null})])
}
async function sendClaim(env:Bindings,s:Schedule,id:string,email:string,scope:string,delivery:Delivery) {
  const db=env.DB,standing=scheduleCondition(s), allowed=recipientCondition(email,scope)
  let attachment:Awaited<ReturnType<typeof retainedAttachment>>
  try{attachment=await retainedAttachment(db,id)}catch{await finish(db,id,'blocked','Retained attachment integrity check failed before sending');return}
  // This is the sole durable transition granting permission to enter the mail
  // provider. Neither interrupted nor uncertain sends are ever claimed again.
  const sent=await db.prepare(`UPDATE pt_report_deliveries SET status='sending',detail='Provider call started; interruption means outcome uncertain'
    WHERE id=? AND status='claimed' AND (${standing.sql}) AND (${allowed.sql})`).bind(id,...standing.params,...allowed.params).run()
  if(sent.meta.changes!==1) {
    await finish(db,id,'cancelled','Owner, consent, schedule revision or recipient access changed before sending')
    return
  }
  const bindings=runtimeBindings(env),mailer=operatorMail(bindings) as unknown as {send(message:Data):Promise<MailResult>}|undefined
  if(!mailer||!bindings.MAIL_FROM) {await finish(db,id,'no-mail','No outgoing mail route is configured');return}
  try {
    const result=await mailer.send({deliveryId:id,from:bindings.MAIL_FROM,to:[email],subject:`${s.name} · ${delivery.from} to ${delivery.to} · ${delivery.basis}`,
      text:`${delivery.name}\n${delivery.from} to ${delivery.to}\nBasis: ${delivery.basis}\nThe original report is attached.`,
      attachments:[{filename:attachment.filename,contentType:attachment.contentType,content:attachment.bytes}]})
    const detail=result.status==='development'?'Development mail is suppressed; no email was sent':result.status==='uncertain'?'Provider outcome is uncertain; automatic resend is disabled':`Mail provider returned ${result.status}${result.code?` (${result.code})`:''}`
    await finish(db,id,result.status,detail,result)
  }catch(error) {
    // A thrown network error cannot prove the provider did not receive bytes.
    const validation=(error as Error)?.name==='MailValidationError'
    await finish(db,id,validation?'rejected':'uncertain',validation?'Mail was refused before sending':'Provider outcome is uncertain after an error; automatic resend is disabled')
  }
}
async function blocked(env:Bindings,s:Schedule,o:Occurrence,detail:string) {
  const db=env.DB,g=scheduleCondition(s),at=now()
  for(const address of JSON.parse(s.recipients) as string[]) {
    await db.prepare(`INSERT OR IGNORE INTO pt_report_deliveries(id,schedule_id,schedule_revision,occurrence,due,recipient,recipient_scope,name,filename,content_type,bytes,sha256,issue,selection,books_revision,from_date,to_date,basis,status,detail,claimed_at,finished_at)
      SELECT ?,?,?,?,?,?,'unresolved',?,'','application/octet-stream',?,'','{}',?,0,?,?,'unknown','blocked',?,?,? WHERE ${g.sql}`).bind(uid(),s.id,s.revision,o.key,o.due,address,s.name,new Uint8Array(),s.selection,o.from,o.to,detail,at,at,...g.params).run()
  }
}
async function claimOccurrence(env:Bindings,s:Schedule,o:Occurrence) {
  const db=env.DB,actor=await standingOwner(db,s)
  if(!actor) {
    // Revoked standing consent is visible on the schedule without disclosing
    // report bytes. Keep an outcome even though no branded reader can be made.
    for(const address of JSON.parse(s.recipients) as string[]) {
      await db.prepare(`INSERT OR IGNORE INTO pt_report_deliveries(id,schedule_id,schedule_revision,occurrence,due,recipient,recipient_scope,name,filename,content_type,bytes,sha256,issue,selection,books_revision,from_date,to_date,basis,status,detail,claimed_at,finished_at)
        SELECT ?,?,?,?,?,?,'unresolved',?,'','application/octet-stream',?,'','{}',?,0,?,?,'unknown','blocked','The creating owner identity is no longer current',?,? WHERE EXISTS(SELECT 1 FROM pt_report_schedules WHERE id=? AND revision=? AND active=1 AND consent=1)`).bind(uid(),s.id,s.revision,o.key,o.due,address,s.name,new Uint8Array(),s.selection,o.from,o.to,now(),now(),s.id,s.revision).run()
    }
    return
  }
  const selection=occurrenceSelection(s,o), revision=await booksRevision(db)
  const addresses=JSON.parse(s.recipients) as string[],recipients=await Promise.all(addresses.map(a=>recipient(db,a)))
  if(recipients.some(r=>!r)){await blocked(env,s,o,'A recipient is no longer in the books or on the active outside allowlist');return}
  const c:Context={db,env,actor,request:new Request(`${runtimeBindings(env).AUTH_ORIGIN}/api/pantry/report-delivery`)}
  let delivery:Delivery
  try {
    delivery=await buildDelivery(c,selection,s.format)
    requireThat(delivery.bytes.length>0&&delivery.bytes.length<=MAX_ATTACHMENT_BYTES,'Report attachment is empty or exceeds the retained attachment limit')
  }catch(error){await blocked(env,s,o,`Report could not be rendered: ${String((error as Error)?.message??'Report unavailable').slice(0,300)}`);return}
  const hash=await attachmentHash(delivery.bytes)
  const parts:Uint8Array[]=[]
  if(delivery.bytes.length>ATTACHMENT_PART_BYTES)for(let at=0;at<delivery.bytes.length;at+=ATTACHMENT_PART_BYTES)parts.push(delivery.bytes.slice(at,at+ATTACHMENT_PART_BYTES))
  const inline=parts.length?new Uint8Array():delivery.bytes
  const claims=recipients.map(r=>({id:uid(),recipient:r!})),g=scheduleCondition(s),at=now()
  await run(db,[guard(g.sql,...g.params),guard('(SELECT COALESCE(MAX(rowid),0) FROM pt_audit)=?',revision),...claims.map(({recipient:r})=>recipientGuard(r.email,r.scope)),
    ...claims.flatMap(({id,recipient:r})=>[q(`INSERT INTO pt_report_deliveries(id,schedule_id,schedule_revision,occurrence,due,recipient,recipient_scope,name,filename,content_type,bytes,sha256,byte_size,part_count,issue,selection,books_revision,from_date,to_date,basis,status,claimed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'claimed',?)`,id,s.id,s.revision,o.key,o.due,r.email,r.scope,delivery.name,delivery.filename,delivery.contentType,inline,hash,delivery.bytes.length,parts.length,JSON.stringify(delivery.issue),JSON.stringify(selection),revision,delivery.from,delivery.to,delivery.basis,at),changed(),...parts.map((part,i)=>q('INSERT INTO pt_report_attachment_parts(delivery_id,part,content) VALUES(?,?,?)',id,i,part))]),
    audit(who(actor),'report-delivery.claim','report-schedule',s.id,{revision:s.revision,occurrence:o.key,recipients:addresses,sha256:hash,issue:delivery.issue})])
  await recordReportIssue(db,who(actor),delivery.issue)
  // Each retained scope is one immutable issue; mail results are per recipient.
  for(const claim of claims)await sendClaim(env,s,claim.id,claim.recipient.email,claim.recipient.scope,delivery)
}
export async function runDueReports(env:Bindings,at=new Date()) {
  const db=env.DB
  await db.prepare("UPDATE pt_report_deliveries SET status='uncertain',detail='Provider call was interrupted; automatic resend is disabled',finished_at=? WHERE status='sending' AND claimed_at<?").bind(now(),new Date(Date.now()-10*60*1000).toISOString()).run()
  // A process interrupted between freeze and send must not silently leave a
  // queued attachment forever; it remains visibly cancelled and is never resent.
  await db.prepare("UPDATE pt_report_deliveries SET status='cancelled',detail='Delivery was interrupted before sending; review the retained attachment',finished_at=? WHERE status='claimed' AND claimed_at<?").bind(now(),new Date(Date.now()-10*60*1000).toISOString()).run()
  for(const s of await all<Schedule>(db,'SELECT * FROM pt_report_schedules WHERE active=1 AND consent=1 ORDER BY id')) {
    for(const o of await occurrences(db,s,at)) {
      try{await claimOccurrence(env,s,o)}catch(error){
        // Concurrent workers lose the unique claim without sending. A books or
        // authority fence failure creates no stale attachment; next tick retries.
        if(!String((error as Error)?.message).includes('already exists'))console.error('Report delivery refused:',s.id,(error as Error)?.message)
      }
    }
  }
}
