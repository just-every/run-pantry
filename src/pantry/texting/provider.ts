import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { requireThat } from '../core'
import { unseal } from '../seal'
import type { Data } from '../core'

export const TEST_FROM='+15005550006'
export async function credentials(env:Bindings,s:Data) {
 const [sid,token]=await Promise.all([unseal(env.SESSION_SECRET,'texting-account',s.account_sid_sealed??''),unseal(env.SESSION_SECRET,'texting-token',s.auth_token_sealed??'')])
 requireThat(sid&&token,'Connect the business Twilio test account first',409)
 return {sid,token}
}
export function callbackUrl(env:Bindings,path:string) {return runtimeBindings(env).AUTH_ORIGIN+'/api/pantry/texting/twilio/'+path}
export async function sendTestText(env:Bindings,s:Data,m:Data) {
 requireThat(s.from_number===TEST_FROM,'Only the Twilio test sender is enabled',409)
 const {sid,token}=await credentials(env,s)
 let response:Response
 try {
  response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,{method:'POST',redirect:'manual',headers:{authorization:'Basic '+btoa(sid+':'+token),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:TEST_FROM,To:m.phone,Body:m.body,StatusCallback:callbackUrl(env,'status?messageId='+encodeURIComponent(m.id))}),signal:AbortSignal.timeout(15000)})
 } catch {return {status:'uncertain',providerId:null,detail:'Provider acceptance is unknown. This attempt will never be replayed automatically.'}}
 const value=await response.json().catch(()=>null) as Data|null
 if(!response.ok) return {status:response.status>=500?'uncertain':'failed',providerId:null,detail:`Twilio test request HTTP ${response.status}; no automatic replay.`}
 if(!value?.sid||!['queued','sent','delivered','failed','undeliverable'].includes(value.status))return {status:'uncertain',providerId:null,detail:'Twilio returned no usable acceptance. No automatic replay.'}
 return {status:value.status as string,providerId:String(value.sid),detail:'Twilio test API acceptance; no real SMS. Test credentials do not emit carrier callbacks.'}
}
export async function validSignature(token:string,url:string,form:URLSearchParams,header:string) {
 let value=url
 for(const key of [...new Set(form.keys())].sort())for(const item of [...new Set(form.getAll(key))].sort())value+=key+item
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['sign'])
 const expected=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value)))))
 return expected.length===header.length&&[...expected].reduce((diff,ch,i)=>diff|(ch.charCodeAt(0)^header.charCodeAt(i)),0)===0
}
