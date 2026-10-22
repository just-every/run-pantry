import type { Data } from '../../core'
import { sourceJson } from './transport'
import { SourceFailure, hashProof, money, object, sourceNeed, sourceString, type Evidence, type Source } from './model'
async function rpc(source:Source,id:number,method:string,params:Data){
 const result=await sourceJson(source,'/api/platter/agent/mcp',{jsonrpc:'2.0',id,method,params})
 sourceNeed(result.jsonrpc==='2.0'&&result.id===id&&!result.error&&object(result.result),'source_invalid')
 return result.result as Data
}
export async function readPlatter(source:Source,estimate:Data,emails:Set<string>):Promise<Evidence>{
 const init=await rpc(source,1,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Pantry owner handoff',version:'1'}})
 sourceNeed(init.protocolVersion==='2025-06-18','source_invalid')
 const result=await rpc(source,2,'tools/call',{name:'read_proposal',arguments:{id:source.remoteId}})
 sourceNeed(!result.isError&&Array.isArray(result.content)&&result.content.length===1&&object(result.content[0])&&result.content[0].type==='text','source_invalid')
 let data:Data;try{data=JSON.parse(result.content[0].text)}catch{throw new SourceFailure('source_invalid')}
 sourceNeed(object(data)&&data.id===source.remoteId,'source_invalid')
 sourceNeed(data.status==='accepted'&&object(data.acceptance),'source_not_accepted')
 const a=data.acceptance
 sourceNeed(Number.isSafeInteger(data.revision)&&a.revision===data.revision,'source_revision_mismatch')
 sourceNeed(a.currency==='USD'&&data.currency==='USD','currency_mismatch')
 const total=money(a.totalCents),deposit=money(a.depositCents)
 sourceNeed(total===estimate.total_cents&&deposit<=total,'amount_mismatch')
 const email=sourceString(a.email,254).toLowerCase();sourceNeed(emails.has(email),'contact_mismatch')
 sourceNeed(Array.isArray(data.options)&&data.options.some((o:Data)=>object(o)&&o.id===a.optionId),'source_invalid')
 sourceNeed(Number.isSafeInteger(a.acceptedAt)&&a.acceptedAt>0&&a.acceptedAt<=8_640_000_000_000_000,'source_invalid')
 const proof={format:'pantry-platter-link/1',proposal_id:source.remoteId,revision:data.revision,title:sourceString(data.title,500),scope:sourceString(data.scope,10000),option_id:sourceString(a.optionId,100),total_cents:total,requested_deposit_cents:deposit,currency:'USD',accepted_name:sourceString(a.name,200),contact_email:email,accepted_at:new Date(a.acceptedAt).toISOString()}
 return {remoteRevision:String(data.revision),proof,proofHash:await hashProof(proof),summary:{title:proof.title,status:'accepted',customer_name:estimate.customer_name,contact_email:email,total_cents:total,deposit_cents:deposit,currency:'USD',accepted_at:proof.accepted_at,deposit_meaning:'requested_not_received',money_received:false}}
}
