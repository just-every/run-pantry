import type { Command, Context } from '../context'
import { who } from '../access'
import { list, now, requireThat, text, uid } from '../core'
import { all, audit, changed, one, q, run, type Sql } from '../db'
import { ownerSession } from '../erasure/owner'
import { destination } from './destination'
import { sealWebhook } from './vault'

export const EVENT_TYPES = ['created','approved','posted','paid','matched','locked']
export const PAYLOAD_FIELDS = ['id','type','time','record.kind','record.id','record.revision','record.status']
const selected = (input: unknown) => {
  const events = [...new Set(list<string>(input,'Events',EVENT_TYPES.length))]
  requireThat(events.every(e=>EVENT_TYPES.includes(e)),'Choose listed webhook event types')
  return events
}
const publicSubscription = (r: Record<string,any>) => ({id:r.id,destination:r.destination,host:r.host,events:JSON.parse(r.events),enabled:!!r.enabled,revision:r.revision,createdAt:r.created_at})
async function secret(c: Context,id: string) {
  const value = [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('')
  return {value,statement:q('INSERT INTO pt_webhook_secrets VALUES (?,?,?,NULL)',uid(),id,await sealWebhook(c.env,value))}
}
async function current(c: Context,b: Record<string,any>) {
  const id=text(b.id,'Webhook'), r=await one(c.db,'SELECT * FROM pt_webhook_subscriptions WHERE id=? AND deleted_at IS NULL',id)
  requireThat(r,'Webhook not found',404)
  requireThat(r.revision===b.revision,'Webhook changed; refresh before changing it',409)
  return r
}
const cancel = (id: string) => q("UPDATE pt_webhook_deliveries SET state='cancelled',lease_until=NULL WHERE subscription_id=? AND state IN ('pending','sending')",id)
const create:Command={need:'owner',async run(c,b) {
  const guards=await ownerSession(c), dest=destination(text(b.destination,'Destination',2048)),events=selected(b.events),id=uid(),revision=uid(),at=now(),issued=await secret(c,id)
  await run(c.db,[...guards,q('INSERT INTO pt_webhook_subscriptions VALUES (?,?,?,?,1,?,?,?,NULL)',id,dest.destination,dest.host,JSON.stringify(events),revision,at,c.actor.email),issued.statement,
    audit(who(c.actor),'webhook.create','webhook',id,{host:dest.host,events})])
  return {...publicSubscription({id,...dest,events:JSON.stringify(events),enabled:1,revision,created_at:at}),secret:issued.value}
}}
const edit:Command={need:'owner',async run(c,b) {
  const guards=await ownerSession(c),r=await current(c,b),dest=destination(text(b.destination,'Destination',2048)),events=selected(b.events),revision=uid()
  // A new consent destination never inherits the previous host's queued data.
  await run(c.db,[...guards,q('UPDATE pt_webhook_subscriptions SET destination=?,host=?,events=?,revision=? WHERE id=? AND revision=? AND deleted_at IS NULL',dest.destination,dest.host,JSON.stringify(events),revision,r.id,r.revision),changed(),cancel(r.id),
    audit(who(c.actor),'webhook.edit','webhook',r.id,{host:dest.host,events})])
  return publicSubscription({...r,...dest,events:JSON.stringify(events),revision})
}}
const rotate:Command={need:'owner',async run(c,b) {
  const guards=await ownerSession(c),r=await current(c,b),revision=uid(),issued=await secret(c,r.id),until=new Date(Date.now()+86400000).toISOString()
  await run(c.db,[...guards,q('UPDATE pt_webhook_subscriptions SET revision=? WHERE id=? AND revision=? AND deleted_at IS NULL',revision,r.id,r.revision),changed(),
    q('UPDATE pt_webhook_secrets SET expires_at=? WHERE subscription_id=? AND expires_at IS NULL',until,r.id),issued.statement,
    audit(who(c.actor),'webhook.rotate','webhook',r.id,{host:r.host,previousValidUntil:until})])
  return {...publicSubscription({...r,revision}),secret:issued.value}
}}
const enabled:Command={need:'owner',async run(c,b) {
  const guards=await ownerSession(c),r=await current(c,b),revision=uid()
  requireThat(typeof b.enabled==='boolean','Choose enabled or disabled')
  if(b.enabled)destination(r.destination)
  const issued=b.enabled&&!await one(c.db,'SELECT id FROM pt_webhook_secrets WHERE subscription_id=? AND expires_at IS NULL',r.id)?await secret(c,r.id):null
  const writes:Sql[]=[q('UPDATE pt_webhook_subscriptions SET enabled=?,owner_id=?,revision=? WHERE id=? AND revision=? AND deleted_at IS NULL',b.enabled?1:0,c.actor.email,revision,r.id,r.revision),changed()]
  if(issued)writes.push(issued.statement)
  if(!b.enabled)writes.push(cancel(r.id))
  await run(c.db,[...guards,...writes,audit(who(c.actor),b.enabled?'webhook.enable':'webhook.disable','webhook',r.id,{host:r.host})])
  return {...publicSubscription({...r,enabled:b.enabled,revision}),...(issued?{secret:issued.value}:{})}
}}
const remove:Command={need:'owner',async run(c,b) {
  const guards=await ownerSession(c),r=await current(c,b)
  await run(c.db,[...guards,q("UPDATE pt_webhook_subscriptions SET enabled=0,destination=NULL,events='[]',deleted_at=?,revision=? WHERE id=? AND revision=? AND deleted_at IS NULL",now(),uid(),r.id,r.revision),changed(),cancel(r.id),q('DELETE FROM pt_webhook_secrets WHERE subscription_id=?',r.id),
    audit(who(c.actor),'webhook.delete','webhook',r.id,{host:r.host})])
  return {id:r.id}
}}
export const webhookCommands={'webhook.create':create,'webhook.edit':edit,'webhook.rotate':rotate,'webhook.set-enabled':enabled,'webhook.delete':remove}
export async function webhookSettings(c:Context) {
  await ownerSession(c)
  const rows=await all(c.db,'SELECT * FROM pt_webhook_subscriptions WHERE deleted_at IS NULL ORDER BY created_at,id')
  const history=await all(c.db,'SELECT event_id,type,kind,record_id,revision,status,host,attempt,at,outcome,status_code,error_class,duration_ms FROM pt_webhook_attempts ORDER BY at DESC,rowid DESC LIMIT 200')
  return {subscriptions:rows.map(publicSubscription),eventTypes:EVENT_TYPES,payloadFields:PAYLOAD_FIELDS,history:history.map(r=>({eventId:r.event_id,eventType:r.type,record:{kind:r.kind,id:r.record_id,revision:r.revision,status:r.status},host:r.host,attempt:r.attempt,at:r.at,outcome:r.outcome,statusCode:r.status_code,errorClass:r.error_class,durationMs:r.duration_ms}))}
}
