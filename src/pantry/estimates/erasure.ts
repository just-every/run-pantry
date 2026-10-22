// Acceptance identity is personal data; the accepted financial commitment and
// its supporting PDF use the same retention clock as converted invoices.
import { all, changed, guard, q, type Sql } from '../db'
import type { Data } from '../core'
import { scrub } from '../erasure/personal'
type Input={id:string;member:boolean;memberEmail?:string;values:string[];marker:string;at:string}
export async function estimateCopies(db:D1Database,input:Input){
 const statements:Sql[]=[],counts:Record<string,Data>={},affectedRecordIds:string[]=[]
 const redact=(value:any):any=>typeof value==='string'?scrub(value,input.values,input.marker):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v)])):value
 for(const row of await all(db,'SELECT * FROM pt_estimates')){
  if(row.erased_at)continue
  const own=!input.member&&row.customer_id===input.id
  const stored=JSON.parse(row.input),pricing=JSON.parse(row.pricing)
  const nextInput=redact(stored),nextPricing=redact(pricing)
  if(own){if(nextInput.memo)nextInput.memo=input.marker;if(nextPricing.memo)nextPricing.memo=input.marker;nextPricing.customer={...nextPricing.customer,billing_address:''}}
  const set:Data={input:JSON.stringify(nextInput),pricing:JSON.stringify(nextPricing)}
  if(own){Object.assign(set,{accepted_name:row.accepted_name?input.marker:null,accepted_ip:null,link_token:null,erased_at:input.at})}
  else if(input.member&&[input.memberEmail,input.id].includes(row.prepared_by))set.prepared_by=input.marker
  if(!own&&row.accepted_name)set.accepted_name=scrub(row.accepted_name,input.values,input.marker)
  const fields=Object.keys(set).filter(k=>set[k]!==row[k])
  if(!fields.length)continue
  statements.push(q(`UPDATE pt_estimates SET ${fields.map(k=>`${k}=?`).join(',')} WHERE id=? AND revision=? AND input=? AND pricing=? AND erased_at IS NULL`,...fields.map(k=>set[k]),row.id,row.revision,row.input,row.pricing),changed())
  affectedRecordIds.push(row.id);counts.pt_estimates={rowsReplaced:(counts.pt_estimates?.rowsReplaced??0)+1,fieldsReplaced:(counts.pt_estimates?.fieldsReplaced??0)+fields.length}
 }
 return {statements,counts,affectedRecordIds}
}
