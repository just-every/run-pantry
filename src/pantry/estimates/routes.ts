import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { themeFrame } from '../../base/theme-frame'
import { fontHead } from '../../base/font-head'
import branding from '../../branding.json'
import type { Context } from '../context'
import { pantry } from '../access'
import { now, requireThat, text } from '../core'
import { audit, changed, q, run } from '../db'
import { base64Bytes } from '../invoice-logo'
import { estimatePreview, publicEstimate } from './documents'

async function acceptanceBody(request:Request){
 const reader=request.body?.getReader();if(!reader)return ''
 const chunks:Uint8Array[]= [];let size=0
 while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength
  if(size>4096){await reader.cancel();requireThat(false,'Request too large',413)}
  chunks.push(next.value)
 }
 const bytes=new Uint8Array(size);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 return new TextDecoder().decode(bytes)
}
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
async function page(title:string,body:string){
 const frame=await themeFrame({href:'/rer-theme.css',productName:branding.name,accentColor:branding.primaryColor})
 return new Response(`<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title>${fontHead}${frame.head}</head><body><main class="invoice"><h1>${escape(title)}</h1>${body}</main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow','content-security-policy':`default-src 'none'; frame-src 'self'; ${frame.policy}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`}})
}
async function customerPage(db:D1Database,token:string){
 const {row,document:doc}=await publicEstimate(db,token)
 return page(doc.title,`<p>${escape(doc.business)}</p><dl>${doc.facts.map(([k,v])=>`<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl><table><thead><tr><th>Description</th><th>Quantity</th><th>Amount</th></tr></thead><tbody>${doc.lines.map(l=>`<tr><td>${escape(l.description)}</td><td>${escape(l.quantity)}</td><td>${escape(l.amount)}</td></tr>`).join('')}</tbody></table><dl>${doc.totals.map(([k,v])=>`<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>${doc.notes.map(n=>`<p>${escape(n)}</p>`).join('')}${row.status==='accepted'?`<p role="status">Accepted by ${escape(row.accepted_name)} on ${escape(row.accepted_at)}.</p>`:`<form method="post" action="/e/${escape(token)}/accept"><input type="hidden" name="revision" value="${escape(row.revision)}"><label for="accept-name">Your name</label><input id="accept-name" name="name" required maxlength="200" autocomplete="name"><p>Accept the estimate above by typing your name. Your name, time and IP address are retained as acceptance evidence.</p><button type="submit">Accept estimate</button></form>`}<p><a href="/e/${escape(token)}/estimate.pdf">Download estimate PDF</a></p>`)
}
export function registerEstimateRoutes(api:Hono<{Bindings:Bindings}>,reader:(c:any)=>Promise<Context>){
 api.get('/api/pantry/estimates/:id/preview',async c=>{
  const ctx=await reader(c),p=await estimatePreview(ctx.db,c.req.param('id'),c.req.query('templateId'))
  const {pdf,...result}=p;return c.json(result)
 })
 api.get('/api/pantry/estimates/:id/pdf',async c=>{
  const ctx=await reader(c),p=await estimatePreview(ctx.db,c.req.param('id'),c.req.query('templateId'))
  return new Response(p.pdf,{headers:{'content-type':'application/pdf','cache-control':'no-store','content-disposition':'inline; filename="estimate.pdf"','content-security-policy':"default-src 'none'; sandbox"}})
 })
 api.get('/e/:token',c=>customerPage(c.env.DB,c.req.param('token')))
 api.get('/e/:token/estimate.pdf',async c=>{
  const {saved}=await publicEstimate(c.env.DB,c.req.param('token'))
  return new Response(base64Bytes(saved.pdf_base64),{headers:{'content-type':'application/pdf','cache-control':'no-store','content-disposition':'inline; filename="estimate.pdf"','content-security-policy':"default-src 'none'; sandbox"}})
 })
 api.post('/e/:token/accept',async c=>{
  requireThat(c.req.header('origin')===runtimeBindings(c.env).AUTH_ORIGIN&&c.req.header('sec-fetch-site')!=='cross-site','Invalid origin',403)
  requireThat(Number(c.req.header('content-length')??0)<=4096,'Request too large',413)
  const encoded=await acceptanceBody(c.req.raw)
  requireThat((c.req.header('content-type')??'').startsWith('application/x-www-form-urlencoded'),'Send the acceptance form',400)
  const token=c.req.param('token'),{row}=await publicEstimate(c.env.DB,token),body=Object.fromEntries(new URLSearchParams(encoded))
  const name=text(body.name,'Your name',200),revision=text(body.revision,'Estimate revision',100)
  requireThat(row.revision===revision,'This estimate changed; reload before accepting',409)
  if(row.status==='accepted'){requireThat(row.accepted_revision===revision&&row.accepted_name===name,'This estimate already has an acceptance',409);return customerPage(c.env.DB,token)}
  // Only the platform-provided peer header is trusted. A caller-supplied body
  // or X-Forwarded-For value never becomes acceptance evidence.
  const ip=c.req.header('cf-connecting-ip'),at=now()
  requireThat(ip,'The platform did not supply a trusted customer IP address; acceptance cannot be recorded',409)
  requireThat(ip.length<=64,'Invalid peer address',400)
  await run(c.env.DB,[q("UPDATE pt_estimates SET status='accepted',accepted_name=?,accepted_at=?,accepted_ip=?,accepted_revision=? WHERE id=? AND revision=? AND link_token=? AND status='sent' AND erased_at IS NULL",name,at,ip,revision,row.id,revision,token),changed(),audit(pantry('customer'),'estimate.accept','estimate',row.id,{revision,acceptedAt:at})])
  return customerPage(c.env.DB,token)
 })
}
