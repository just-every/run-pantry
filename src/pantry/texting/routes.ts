import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { now, requireThat, uid } from '../core'
import { audit, guard, one, q, run } from '../db'
import { callbackUrl, credentials, validSignature } from './provider'
import { phoneNumber } from './policy'
import { textingSettings } from './store'

const actor={email:'pantry:twilio',kind:'integration' as const}
const xml=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!))
async function verified(request:Request,env:Bindings,path:string) {
 requireThat((request.headers.get('content-type')??'').startsWith('application/x-www-form-urlencoded'),'Send a form request',400)
 requireThat(Number(request.headers.get('content-length')??0)<=8192,'Request too large',413)
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0
 if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8192){await reader.cancel();requireThat(false,'Request too large',413)}chunks.push(part.value)}
 const bytes=new Uint8Array(size);let offset=0
 for(const part of chunks){bytes.set(part,offset);offset+=part.length}
 const params=new URLSearchParams(new TextDecoder().decode(bytes)),s=await textingSettings(env.DB),{sid,token}=await credentials(env,s)
 requireThat(await validSignature(token,callbackUrl(env,path),params,request.headers.get('x-twilio-signature')??''),'Twilio signature is invalid',403)
 requireThat(params.get('AccountSid')===sid,'Twilio account does not match',403)
 return {params,s}
}
export function registerTextingRoutes(api:Hono<{Bindings:Bindings}>) {
 api.post('/api/pantry/texting/twilio/status',async c=>{
  const query=new URL(c.req.url).search,id=c.req.query('messageId')
  requireThat(id,'Message reference is required')
  const {params}=await verified(c.req.raw,c.env,'status'+query),m=await one(c.env.DB,'SELECT * FROM pt_text_messages WHERE id=?',id)
  requireThat(m&&m.provider_message_id===params.get('MessageSid'),'Text message does not match',404)
  const status=params.get('MessageStatus')
  requireThat(status&&['queued','sent','delivered','failed','undeliverable'].includes(status),'Unknown message status')
  const detail=params.get('ErrorCode')?`Twilio error ${String(params.get('ErrorCode')).replace(/[^0-9]/g,'').slice(0,10)}`:'Signed Twilio status callback (test account: synthetic event)'
  const terminal=['delivered','failed','undeliverable'],rank:Record<string,number>={queued:1,sent:2,delivered:3,failed:3,undeliverable:3},at=now()
  // Every distinct signed outcome is retained, including a late callback;
  // terminal outcomes and later progress never regress to queued or sent.
  await run(c.env.DB,[
   q('INSERT OR IGNORE INTO pt_text_events(id,message_id,status,at,detail)VALUES(?,?,?,?,?)',uid(),id,status,at,detail),
   q(`UPDATE pt_text_messages SET status=?,detail=?,updated_at=? WHERE id=? AND status NOT IN ('delivered','failed','undeliverable','cancelled') AND CASE status WHEN 'queued' THEN 1 WHEN 'sent' THEN 2 ELSE 0 END<=?`,status,detail,at,id,rank[status]),
   audit(actor,'texting.status',m.subject_kind,m.subject_id,{messageId:id,status,terminal:terminal.includes(status),syntheticTestAccount:true})])
  return c.json({ok:true})
 })
 api.post('/api/pantry/texting/twilio/inbound',async c=>{
  const {params,s}=await verified(c.req.raw,c.env,'inbound'),from=phoneNumber(params.get('From')),body=(params.get('Body')??'').trim().toUpperCase(),sid=params.get('MessageSid'),at=now()
  requireThat(sid&&sid.length<=100,'Inbound message ID is required')
  requireThat(params.get('To')===s.from_number,'Inbound recipient does not match',403)
  const stop=/^(STOP(?:ALL)?|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPT[ -]?OUT)(?:\b|[.!])/i.exec(body)?.[1]
  const help=/^(HELP|INFO)(?:\b|[.!])/i.test(body),keyword=stop?'STOP':help?'HELP':'OTHER'
  if(!await one(c.env.DB,'SELECT 1 FROM pt_text_inbound WHERE provider_id=?',sid)) {
   const consent=await one(c.env.DB,'SELECT * FROM pt_text_consents WHERE phone=?',from)
   await run(c.env.DB,[q('INSERT OR IGNORE INTO pt_text_inbound(provider_id,phone,keyword,at)VALUES(?,?,?,?)',sid,from,keyword,at),...(stop?[
    q('INSERT INTO pt_text_blocks(phone,at,keyword)VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET at=excluded.at,keyword=excluded.keyword',from,at,stop),
    q('UPDATE pt_text_consents SET revoked_at=?,revision=? WHERE phone=?',at,uid(),from),
    q("UPDATE pt_text_messages SET status='cancelled',updated_at=?,detail='Customer opted out' WHERE phone=? AND status='held'",at,from)
   ]:[]),audit(actor,'texting.inbound',consent?'customer':'texting',consent?.customer_id??'1',{phone:from,keyword,providerMessageId:sid,at,syntheticTestAccount:true})])
  }
  const response=help?`<Response><Message>${xml(s.business_contact||'Contact the business using the contact details on your invoice.')} Reply STOP to stop texts.</Message></Response>`:'<Response></Response>'
  return c.body(response,200,{'content-type':'application/xml; charset=utf-8','cache-control':'no-store'})
 })
}
