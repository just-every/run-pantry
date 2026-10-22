import { destination } from '../../webhooks/destination'
import { requireThat, text } from '../../core'
import type { Context } from '../../context'
import { SourceFailure, type Source, object } from './model'

export function siblingOrigin(c:Context,raw:unknown){
 const value=text(raw,'Sibling installation origin',300)
 let url:URL;try{url=new URL(value)}catch{requireThat(false,'Enter a valid sibling installation origin')}
 requireThat(!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&!value.includes('\\'),'Enter only the sibling installation origin, without a path or credentials')
 const local=c.env.AUTH_LOCAL==='true'&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)
 if(!local){requireThat(url.protocol==='https:','Use HTTPS; loopback HTTP is allowed only in actual local development');destination(url.origin)}
 return url.origin
}
/** One exact-origin request. The deadline includes bounded body consumption. */
export async function sourceBytes(source:Source,path:string,max:number,body?:unknown):Promise<Uint8Array<ArrayBuffer>>{
 const url=new URL(path,source.origin)
 if(url.origin!==source.origin)throw new SourceFailure('origin_refused')
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),10_000)
 try{
  let response:Response
  try{response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${source.token}`,accept:body===undefined?'application/json, application/pdf':'application/json, text/event-stream',...(body===undefined?{}:{'content-type':'application/json','mcp-protocol-version':'2025-06-18'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:abort.signal})}
  catch{throw new SourceFailure(abort.signal.aborted?'source_timeout':'source_unavailable')}
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw new SourceFailure('source_redirect')}
  if(!response.ok){await response.body?.cancel();throw new SourceFailure([401,403].includes(response.status)?'source_auth':response.status===404?'source_missing':'source_unavailable')}
  if(Number(response.headers.get('content-length')??0)>max){await response.body?.cancel();throw new SourceFailure('source_too_large')}
  const reader=response.body?.getReader();if(!reader)throw new SourceFailure('source_invalid')
  const chunks:Uint8Array[]= [];let count=0
  while(true){let part:ReadableStreamReadResult<Uint8Array>;try{part=await reader.read()}catch{throw new SourceFailure(abort.signal.aborted?'source_timeout':'source_unavailable')};if(part.done)break;count+=part.value.length
   if(count>max){await reader.cancel();throw new SourceFailure('source_too_large')}chunks.push(part.value)
  }
  const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes
 }finally{clearTimeout(timer)}
}
export async function sourceJson(source:Source,path:string,body?:unknown){
 const bytes=await sourceBytes(source,path,512*1024,body)
 try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(object(value))return value}catch{}
 throw new SourceFailure('source_invalid')
}
