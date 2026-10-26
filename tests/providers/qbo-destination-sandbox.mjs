// Explicit MIGRATE-006 sandbox journey. Never included in push Verify.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { harness } from '../api/harness.mjs'
import { destinationBooks } from '../api/portability-journey.mjs'

assert.equal(process.env.PANTRY_QBO_SANDBOX_WRITE, 'yes', 'Explicit sandbox write authorization is required')
for (const key of ['QBO_CLIENT_ID','QBO_CLIENT_SECRET','QBO_REFRESH_TOKEN','QBO_REALM_ID','PANTRY_TOKEN_INGEST']) assert.ok(process.env[key], `Missing ${key}`)
const realm = process.env.QBO_REALM_ID, host = 'https://sandbox-quickbooks.api.intuit.com', label = `synthetic-pantry-881-${Date.now()}`
const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', { method:'POST', headers:{authorization:`Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded',accept:'application/json'}, body:new URLSearchParams({grant_type:'refresh_token',refresh_token:process.env.QBO_REFRESH_TOKEN}) })
assert.equal(tokenResponse.status,200,'Intuit authorization must succeed')
const grant = await tokenResponse.json()
assert.equal(typeof grant.access_token,'string');assert.equal(typeof grant.refresh_token,'string')
// Persist the provider's rotated grant before any sandbox operation.
const privateDir=await mkdtemp(join(tmpdir(),'pantry-qbo-grant-'))
try { const file=join(privateDir,'grant.env');await writeFile(file,`QBO_REFRESH_TOKEN=${grant.refresh_token}\n`,{mode:0o600});execFileSync('python3',['-I',process.env.PANTRY_TOKEN_INGEST,file],{stdio:'pipe'}) } finally {await rm(privateDir,{recursive:true,force:true})}
const created = {}, requestIds = new Map()
async function qbo(path, init={}) {
 const response=await fetch(host+path,{...init,headers:{authorization:`Bearer ${grant.access_token}`,accept:'application/json',...(init.body instanceof FormData?{}:{'content-type':'application/json'}),...init.headers}})
 const body=await response.json()
 assert.ok(response.ok&&!body.Fault,`Intuit refused a ${init.method??'GET'} operation (HTTP ${response.status}, code ${body.Fault?.Error?.[0]?.code??'none'}): ${body.Fault?.Error?.[0]?.Message??'unknown outcome'} ${body.Fault?.Error?.[0]?.Detail??''}`)
 return body
}
const query=async resource=>(await qbo(`/v3/company/${realm}/query?${new URLSearchParams({query:`SELECT * FROM ${resource} MAXRESULTS 1000`,minorversion:'75'})}`)).QueryResponse[resource]??[]
const report=async()=>qbo(`/v3/company/${realm}/reports/TrialBalance?${new URLSearchParams({start_date:'1900-01-01',end_date:'2026-12-31',accounting_method:'Accrual',minorversion:'75'})}`)
const cents = value => { const raw=String(value??'').replace(/,/g,'')||'0',m=/^(-?)(\d*)?(?:\.(\d{0,2}))?$/.exec(raw);assert.ok(m,'Provider amount must have at most two decimal places');return (m[1]?-1:1)*(Number(m[2]||'0')*100+Number((m[3]??'').padEnd(2,'0'))) }
function balances(value) {const result=new Map(),columns=value.Columns.Column,di=columns.findIndex(c=>c.ColTitle==='Debit'),ci=columns.findIndex(c=>c.ColTitle==='Credit');assert.ok(di>=0&&ci>=0);const walk=rows=>{for(const r of rows){if(r.ColData?.[0]?.id)result.set(r.ColData[0].id,cents(r.ColData[di]?.value)-cents(r.ColData[ci]?.value));if(r.Rows)walk(r.Rows.Row??[])}};walk(value.Rows.Row??[]);return result}
const h=await harness()
try {
 const command=async(op,b)=>{
  if(['contact.save','item.save'].includes(op))b={...b,name:`${label} ${b.name}`,...(b.sku?{sku:label}:{}),...(b.reference?{reference:label}:{})}
  if(op==='journal.save-draft'||op==='invoice.save-draft')b={...b,memo:`${label} ${b.memo??''}`}
  if(op==='bill.save')b={...b,memo:label}
  const result=await h.command(op,b)
  if(op==='chart.start')for(const a of (await h.view('state')).accounts)await h.command('account.save',{id:a.id,revision:a.revision,code:a.code,name:`${label} ${a.name}`,type:a.type,subtype:a.subtype,description:a.description})
  return result
 }
 const source=await destinationBooks(command,h.view)
 const exported=await h.view('portability/export?destination=qbo&year=2026&format=json'),{manifest,transport}=exported
 assert.deepEqual(transport.blockers,[],'The source fixture must have a complete native request plan')
 const bundled=await build({entryPoints:['src/pantry/portability/transport.ts'],bundle:true,write:false,format:'esm',platform:'node',logLevel:'error'})
 const {resolveOperation}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
 const accounts=await query('Account'),ids={}
 for(const mapping of transport.mappings){if(mapping.key.startsWith('EquityDetail:')){ids[mapping.key]='OwnersEquity';continue}assert.ok(mapping.key.startsWith('Account:'));const sourceId=mapping.key.slice(8),a=(await h.view('state')).accounts.find(a=>a.id===sourceId),type=a.subtype==='receivable'?'Accounts Receivable':a.subtype==='payable'?'Accounts Payable':a.subtype==='bank'?(a.type==='liability'?'Credit Card':'Bank'):null;const matches=accounts.filter(v=>type?v.AccountType===type:v.AccountSubType==='RetainedEarnings');assert.ok(matches.length>0,`No actual ${a.subtype} account is available`);ids[mapping.key]=matches.sort((a,b)=>Number(a.Id)-Number(b.Id))[0].Id}
 // This shared sandbox already holds other businesses' charts. The fixture
 // owner explicitly maps an identical code and financial class before create.
 const classes={asset:'Asset',liability:'Liability',equity:'Equity',income:'Revenue',expense:'Expense'}
 for(const a of (await h.view('state')).accounts){if(ids[`Account:${a.id}`])continue;const sameCode=accounts.filter(v=>v.AcctNum===a.code);if(sameCode.length){assert.equal(sameCode.length,1,'Destination account code is ambiguous');assert.equal(sameCode[0].Classification,classes[a.type],'Destination account code has another financial class');ids[`Account:${a.id}`]=sameCode[0].Id}}
 const before=balances(await report())
 for(const operation of transport.operations){
  if(operation.key.startsWith('Account:')&&ids[operation.key])continue
  const resolved=resolveOperation(operation,ids,{realmId:realm}),requestId=randomUUID();requestIds.set(operation.key,requestId)
  const path=resolved.path+`?${new URLSearchParams({minorversion:'75',requestid:requestId,include:'allowduplicatedocnum'})}`
  const response=await qbo(path,{method:resolved.method,body:resolved.body})
  let id=response;for(const part of operation.responseId.split('.'))id=id?.[part]
  assert.ok(id,`Intuit omitted the created ${operation.key.split(':')[0]} ID`);ids[operation.key]=String(id)
  const kind=operation.key.split(':')[0];created[kind]=(created[kind]??0)+1
 }
 let uploaded=0
 for(const attachment of transport.attachments){const inventory=manifest.documents.find(d=>d.id===attachment.sourceId),original=await fetch(h.origin+'/api/pantry/documents/'+inventory.id,{headers:{cookie:h.owner}});assert.equal(original.status,200);const bytes=Buffer.from(await original.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),inventory.sha256);const metadata=structuredClone(attachment.metadata);metadata.AttachableRef[0].EntityRef.value=ids[attachment.target];const form=new FormData();form.append(attachment.metadataPart,new Blob([JSON.stringify(metadata)],{type:'application/json'}),'metadata.json');form.append(attachment.contentPart,new Blob([bytes],{type:attachment.mediaType}),metadata.FileName);const response=await qbo(`/v3/company/${realm}/upload?minorversion=75`,{method:'POST',body:form});assert.ok(response.AttachableResponse?.[0]?.Attachable?.Id,'Intuit must accept the original upload');uploaded++}
 const after=balances(await report())
 for(const account of manifest.closingTrialBalance.accounts){const id=ids[`Account:${account.sourceId}`];assert.ok(id,'Every posted source account has a destination identity');assert.equal((after.get(id)??0)-(before.get(id)??0),account.netMinor,`Destination balance differs for source code ${account.code}`)}
 const invoices=await query('Invoice'),bills=await query('Bill')
 assert.equal(cents(invoices.find(v=>v.Id===ids[`Invoice:${source.invoice.id}`]).Balance),source.invoice.total_cents)
 assert.equal(cents(bills.find(v=>v.Id===ids[`Bill:${source.bill.id}`]).Balance),source.bill.total_cents)
 console.log(JSON.stringify({sandbox:'Intuit',realmSuffix:realm.slice(-4),label,created,uploaded,trialBalanceAccounts:manifest.closingTrialBalance.accounts.length,trialBalanceAgrees:true,openItemsAgree:true,sourceDebitMinor:manifest.closingTrialBalance.debitMinor,sourceCreditMinor:manifest.closingTrialBalance.creditMinor}))
} finally {await h.close();console.log(JSON.stringify({sandboxRecordsRetained:created,label}))}
