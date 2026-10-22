import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {books,harness} from './harness.mjs'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')

// Only sibling HTTP is faked here. Real sibling Workers are exercised by the
// separate installation journey; every Pantry action below uses native HTTP.
export async function estimateSiblingsJourney(t){
 const token='synthetic-pantry-81',state={mode:'happy',remoteId:'synthetic-envelope-1',originalHash:'',pdf:Buffer.from('%PDF-1.4\n% synthetic signed network-edge fixture\n%%EOF'),calls:0}
 const handoff=()=>({format:'inkwell-handoff/1',envelopeId:state.remoteId,title:'Synthetic estimate signature',status:state.mode==='status'?'prepared':'completed',originalSha256:state.mode==='mismatch'?'0'.repeat(64):state.originalHash,signedSha256:digest(state.pdf),executedOn:'2026-10-22T01:00:00.000Z',signers:[{name:'Synthetic signer',email:'sibling@example.test',signedAt:'2026-10-22T01:00:00.000Z'}],accepted_ip:'192.0.2.199',private_token:token})
 const h=await harness({outbound:async request=>{
  state.calls++;assert.equal(request.headers.get('authorization'),`Bearer ${token}`)
  const url=new URL(request.url)
  if(state.mode==='auth')return Response.json({error:token},{status:401})
  if(state.mode==='failure')throw new Error('Synthetic transport failure')
  if(state.mode==='erasure-race'){state.readStarted();await state.readReleased;return new Response(null,{status:503})}
  if(state.mode==='redirect')return new Response(null,{status:302,headers:{location:'https://elsewhere.example/'}})
  if(state.mode==='oversize')return new Response('{}',{headers:{'content-length':'9000000'}})
  if(url.hostname==='synthetic-inkwell.example'){
   if(url.pathname.endsWith('/handoff'))return Response.json(handoff())
   if(url.pathname.endsWith('/signed'))return new Response(state.mode==='signed-mismatch'?Buffer.from('%PDF-altered'):state.pdf,{headers:{'content-type':'application/pdf'}})
  }
  if(url.hostname==='synthetic-platter.example'){
   const m=await request.json()
   assert.equal(url.pathname,'/api/platter/agent/mcp')
   if(m.method==='initialize')return Response.json({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18'}})
   assert.equal(m.method,'tools/call');assert.equal(m.params.name,'read_proposal')
   const data={id:'synthetic-proposal-1',title:'Synthetic full proposal',scope:'Design the agreed project',status:state.mode==='status'?'sent':'accepted',revision:4,currency:'USD',options:[{id:'one',cents:1200000}],acceptance:{revision:4,name:'Synthetic signer',email:state.mode==='contact'?'outside@example.test':'sibling@example.test',optionId:'one',totalCents:state.mode==='price'?1200001:1200000,depositCents:300000,currency:'USD',acceptedAt:Date.parse('2026-10-22T01:00:00Z')},shareToken:token,accepted_ip:'192.0.2.199'}
   return Response.json({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify(data)}]}})
  }
  throw new Error('Unexpected synthetic sibling destination')
 }})
 t.after(()=>h.close())
 const {acct}=await books(h)
 await h.command('entity.save',{revision:(await h.view('state')).settings.entity.revision,legalName:'Juniper Lane Design LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2010-01-01',policies:''})
 const customer=await h.command('contact.save',{kind:'customer',name:'Synthetic sibling customer',email:'sibling@example.test'})
 let e=await h.command('estimate.save-draft',{customerId:customer.id,issueDate:'2018-01-01',lines:[{description:'Design project',quantity:'1',rate:'12000',accountId:acct['4000'],taxCode:'exempt'}]})
 e=await h.command('estimate.send',{id:e.id,revision:e.revision});state.originalHash=e.pdf_sha256
 const input=provider=>({id:e.id,revision:e.revision,provider,origin:`https://synthetic-${provider}.example`,remoteId:provider==='inkwell'?state.remoteId:'synthetic-proposal-1',token})
 const view=()=>h.view(`estimates/${e.id}/siblings`)
 const preview=provider=>h.command('estimate.sibling-preview',input(provider))
 const attach=p=>h.command('estimate.sibling-confirm',{id:e.id,revision:e.revision,previewId:p.id,previewRevision:p.revision})
 const viewer=await h.member('sibling-viewer@example.test','viewer')
 const before=state.calls
 await h.command('estimate.sibling-preview',input('inkwell'),viewer,403)
 await h.view(`estimates/${e.id}/siblings`,viewer,403)
 for(const role of ['accountant','bookkeeper','sales','payables-clerk','time-only']){
  const person=await h.member(`sibling-${role}@example.test`,role,{canPost:true})
  await h.command('estimate.sibling-preview',input('inkwell'),person,403)
  await h.command('estimate.sibling-confirm',{id:e.id,revision:e.revision,previewId:'unreviewed',previewRevision:'unreviewed'},person,403)
  await h.view(`estimates/${e.id}/siblings`,person,403)
 }
 const agent=await h.agent('synthetic-sibling-reader')
 assert.equal((await h.send('/api/pantry/command/estimate.sibling-preview',input('inkwell'),{headers:{authorization:`Bearer ${agent.token}`}})).status,401)
 assert.equal(state.calls,before)
 for(const [mode,code] of [['auth','source_auth'],['redirect','source_redirect'],['failure','source_unavailable'],['oversize','source_too_large'],['mismatch','original_mismatch'],['signed-mismatch','signed_mismatch'],['status','source_not_completed']]){
  state.mode=mode;const result=await preview('inkwell');assert.equal(result.ok,false);assert.equal(result.failure.error_class,code)
 }
 for(const [mode,code] of [['status','source_not_accepted'],['price','amount_mismatch'],['contact','contact_mismatch']]){
  state.mode=mode;const result=await preview('platter');assert.equal(result.ok,false);assert.equal(result.failure.error_class,code)
 }
 state.mode='happy'
 const iw=(await preview('inkwell')).preview
 assert.equal(iw.pdf_sha256,digest(state.pdf))
 assert.equal((await view()).links.length,0)
 const confirm={id:e.id,revision:e.revision,previewId:iw.id,previewRevision:iw.revision}
 await h.command('estimate.sibling-confirm',{...confirm,previewRevision:'stale'},h.owner,409)
 const linked=(await attach(iw)).link
 assert.equal((await attach(iw)).link.id,linked.id)
 const pdf=await fetch(h.origin+linked.document_href,{headers:{cookie:h.owner}})
 assert.equal(pdf.status,200);assert.deepEqual(Buffer.from(await pdf.arrayBuffer()),state.pdf)
 const reader=await h.send(linked.document_href,undefined,{cookie:viewer});assert.equal(reader.status,403)
 const pl=(await preview('platter')).preview
 assert.equal(pl.summary.deposit_cents,300000);assert.equal(pl.summary.money_received,false)
 await attach(pl)
 const attached=await view()
 const credential=await h.command('integration.create',{name:'Synthetic sibling metadata',scopes:['estimate-sibling-links:read']})
 const external=await h.send('/api/pantry/integration/v1/estimate-sibling-links?estimateId='+e.id,undefined,{headers:{authorization:`Bearer ${credential.token}`}})
 assert.equal(external.status,200);assert.equal(external.value.records.length,2)
 assert.doesNotMatch(JSON.stringify(external.value),/contact_email|summary|proof"|pdf_base64|origin|remote_id|192\.0\.2/)
 const insufficient=await h.command('integration.create',{name:'Synthetic estimate-only metadata',scopes:['estimates:read']})
 assert.equal((await h.send('/api/pantry/integration/v1/estimate-sibling-links',undefined,{headers:{authorization:`Bearer ${insufficient.token}`}})).status,403)
 assert.equal((await h.send(`/api/pantry/estimates/${e.id}/siblings`,undefined,{headers:{authorization:`Bearer ${credential.token}`}})).status,401)
 assert.equal(attached.links.length,2);assert.equal(attached.attempts.length,10)
 assert.doesNotMatch(JSON.stringify(attached),new RegExp(token+'|192\\.0\\.2\\.199|shareToken|private_token|pdf_base64|"proof"'))
 assert.equal((await h.view(`estimates/${e.id}`)).status,'sent','Sibling evidence never accepts the native estimate')
 assert.equal((await h.view('sales')).invoices.length,0)
 assert.equal((await h.view('customer-deposits')).deposits.length,0)
 // A later local quote revision cannot confirm a previously read source.
 const stale=(await preview('platter')).preview
 e=await h.command('estimate.save-draft',{...e.input,id:e.id,revision:e.revision,memo:'New native revision'})
 await h.command('estimate.sibling-confirm',{id:e.id,revision:e.revision,previewId:stale.id,previewRevision:stale.revision},h.owner,409)
 assert.equal((await view()).links.length,2)
 // Original source proof supports real posted books until owner-confirmed
 // expiry; temporary previews and read errors have no such custody claim.
 e=await h.command('estimate.send',{id:e.id,revision:e.revision})
 const accepted=await h.send(e.public_path+'/accept',undefined,{raw:new URLSearchParams({name:'Synthetic signer',revision:e.revision}).toString(),headers:{'content-type':'application/x-www-form-urlencoded','cf-connecting-ip':'192.0.2.81'}})
 assert.equal(accepted.status,200)
 const converted=await h.command('estimate.convert',{id:e.id,revision:e.revision,requestId:'synthetic-sibling-posted',issueDate:'2018-01-02',mode:'full'})
 await h.command('invoice.approve',{id:converted.invoice.id,revision:converted.invoice.revision})
 const invoice=await h.command('invoice.issue',{id:converted.invoice.id})
 const bank=await h.command('bank-account.save',{name:'Sibling archive checking',institution:'Local',accountId:acct['1000'],numberLast4:'0081',openingDate:'2010-01-01',openingBalance:'0.00'})
 await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2018-01-03',amount:'12000',bankAccountId:bank.id,method:'check',reference:'synthetic-sibling-paid',allocations:[{targetId:invoice.id,amount:'12000'}]})
 const erase=async id=>{
  const p=await h.command('erasure.preview',{kind:'contact',id});assert.equal(p.blockers.length,0)
  return h.command('erasure.execute',{kind:'contact',id,fingerprint:p.fingerprint,requester:'privacy@example.test',reason:'Remove obsolete customer identity',channel:'email',confirm:'ERASE'})
 }
 let release,started
 state.readReleased=new Promise(resolve=>{release=resolve})
 const reading=new Promise(resolve=>{started=resolve});state.readStarted=started;state.mode='erasure-race'
 const pending=h.send('/api/pantry/command/estimate.sibling-preview',input('inkwell'),{cookie:h.owner})
 await reading
 const receipt=await erase(customer.id)
 release();assert.equal((await pending).status,409);state.mode='happy'
 assert.equal(receipt.counts.pt_estimate_sibling_previews.rowsRemoved>0,true)
 assert.equal(receipt.counts.pt_estimate_sibling_attempts.rowsRemoved,10)
 const retained=await view()
 assert.deepEqual(retained.previews,[]);assert.deepEqual(retained.attempts,[])
 assert.equal(retained.links.find(l=>l.id===linked.id).proof_sha256,linked.proof_sha256)
 assert.doesNotMatch(JSON.stringify(retained),/sibling@example\.test|Synthetic sibling customer/)
 const retainedPdf=await h.send(linked.document_href,undefined,{cookie:h.owner})
 assert.equal(retainedPdf.status,200);assert.equal(digest(Buffer.from(retainedPdf.value)),linked.pdf_sha256)
 let policy=await h.view('erasure')
 policy=await h.command('retention.save',{years:1,revision:policy.revision})
 const items=policy.ready.filter(r=>r.table==='pt_estimate_sibling_links')
 assert.equal(items.length,2)
 const expired=await h.command('retention.erase',{ids:items.map(r=>r.key),revision:policy.revision,confirm:'ERASE'})
 assert.equal(expired.counts.pt_estimate_sibling_links.itemsErased,2)
 const gone=await view()
 assert.ok(gone.links.every(l=>l.erased_at&&l.document_href===null))
 assert.equal(gone.links.find(l=>l.id===linked.id).proof_sha256,linked.proof_sha256)
 assert.equal(gone.links.find(l=>l.id===linked.id).pdf_sha256,linked.pdf_sha256)
 assert.equal((await h.send(linked.document_href,undefined,{cookie:h.owner})).status,410)
 // Without posted transactions the whole unused enquiry is removed, including
 // attached documents, without leaving dangling estimate foreign keys.
 const unused=await h.command('contact.save',{kind:'customer',name:'Synthetic unused sibling customer',email:'sibling@example.test'})
 e=await h.command('estimate.save-draft',{customerId:unused.id,issueDate:'2026-10-22',lines:[{description:'Unused design',quantity:'1',rate:'12000',accountId:acct['4000'],taxCode:'exempt'}]})
 e=await h.command('estimate.send',{id:e.id,revision:e.revision});state.originalHash=e.pdf_sha256;state.remoteId='synthetic-unused-envelope-1'
 const unusedLink=(await attach((await preview('inkwell')).preview)).link
 await preview('inkwell');state.mode='auth';await preview('inkwell');state.mode='happy'
 const unusedReceipt=await erase(unused.id)
 assert.equal(unusedReceipt.counts.pt_estimate_sibling_links.rowsRemoved,1)
 assert.equal((await view()).links.length,0)
 assert.equal((await h.send(unusedLink.document_href,undefined,{cookie:h.owner})).status,404)
 return {estimateId:e.id}
}
