// Outside push Verify: measure the real authenticated hosted report doors.
// The caller provisions disposable synthetic books; this journey reads only.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,relative} from 'node:path'
import {hostedR2} from '../../scripts/hosted-r2.mjs'

const args=process.argv.slice(2)
assert.equal(args.length,4,'Use --input PRIVATE.json --receipt OUTSIDE.json')
assert.equal(args[0],'--input'); assert.equal(args[2],'--receipt')
for(const path of [args[1],args[3]])assert.ok(relative(process.cwd(),resolve(path)).startsWith('..'),'Keep private inputs and run receipts outside the checkout')
const runId='sx-pantry-c-f9-hosted-scale-'+new Date().toISOString()
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','Run a clean committed candidate')
const input=JSON.parse(await readFile(args[1],'utf8')),origin=new URL(input.origin).origin
assert.ok(/^https:/.test(origin))
assert.ok(input.cookie&&input.databaseId,'The disposable installation needs a native owner session and D1 identity')
const health=await fetch(origin+'/health',{redirect:'manual',headers:{'cache-control':'no-cache'}})
assert.equal(health.status,200,'The hosted deployment must report its identity')
assert.equal((await health.json()).deployment?.sourceSha,head,'Measure the exact committed candidate deployed at this origin')
const headers={authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'}
const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID+'/d1/database/'+input.databaseId+'/query',{method:'POST',headers,body:JSON.stringify({sql:"SELECT (SELECT count(*) FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id WHERE e.status='posted') AS lines,(SELECT count(*) FROM pt_documents) AS documents,min(entry_date) AS first,max(entry_date) AS last FROM pt_journal_entries WHERE status='posted'"})})
assert.equal(response.status,200)
const inventory=(await response.json()).result[0].results[0]
assert.deepEqual(inventory,{lines:250000,documents:20000,first:'2021-01-01',last:'2025-12-31'},'The hosted books must contain exactly the promised five-year scale')
const kinds=['trial-balance','general-ledger','profit-and-loss','balance-sheet','cash-flow','sales-tax','sales-by-customer','sales-by-item','expenses-by-vendor','receivables','payables','receivables-summary','payables-summary','open-invoices','unpaid-bills','customer-balances','vendor-balances','transactions','journal','deposits','check-detail','reconciliations','audit-log','contractor-summary','adjusting-entries']
// Count the real private objects as well as D1 metadata. A row-only load does
// not establish the hosted document-storage acceptance point.
const custodyResponse=await fetch('https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID+'/d1/database/'+input.databaseId+'/query',{method:'POST',headers,body:JSON.stringify({sql:"SELECT state,count(*) AS count FROM pt_document_objects GROUP BY state ORDER BY state"})})
assert.equal(custodyResponse.status,200)
const custody=(await custodyResponse.json()).result[0].results
assert.deepEqual(custody,[{state:'ready',count:20000}],'All loaded originals must be durably stored, with no pending staging')
assert.ok(input.bucketName,'Name the disposable deployment document bucket')
const bucket=hostedR2({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,bucketName:input.bucketName})
let cursor,objectCount=0,objectBytes=0
const actualObjects=[]
const cursors=new Set()
do {
 const page=await bucket.list({prefix:'documents/',cursor})
 objectCount+=page.objects.length;objectBytes+=page.objects.reduce((n,o)=>n+o.size,0)
 actualObjects.push(...page.objects.map(o=>({key:o.key,size:o.size})))
 cursor=page.truncated?page.cursor:undefined
 if(page.truncated){assert.ok(cursor,'A truncated inventory must have a next cursor');assert.ok(!cursors.has(cursor),'The object inventory must advance');cursors.add(cursor)}
}while(cursor)
assert.equal(objectCount,20000,'Count actual private objects, not only document rows')
assert.ok(objectBytes>=20000,'Each original has content')
const expectedResponse=await fetch('https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID+'/d1/database/'+input.databaseId+'/query',{method:'POST',headers,body:JSON.stringify({sql:'SELECT o.object_key AS key,d.size FROM pt_document_objects o JOIN pt_documents d ON d.id=o.document_id ORDER BY o.object_key'})})
assert.equal(expectedResponse.status,200)
const expectedObjects=(await expectedResponse.json()).result[0].results
assert.deepEqual(actualObjects.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0),expectedObjects,'The private object keys and sizes must match the independently stored document custody')
const measurements=[],failures=[]
for(const basis of ['accrual','cash'])for(const kind of kinds) {
 try {
 const started=performance.now(),r=await fetch(origin+'/api/pantry/reports/'+kind+'?from=2021-01-01&to=2025-12-31&basis='+basis,{headers:{cookie:input.cookie},redirect:'manual'})
 const body=await r.text(),milliseconds=performance.now()-started
 measurements.push({kind,basis,http:r.status,milliseconds:Math.round(milliseconds),bytes:Buffer.byteLength(body)})
 if(r.status!==200||milliseconds>=3000)failures.push({kind,basis,http:r.status,milliseconds:Math.round(milliseconds)})
 if(r.status===200) {
  const value=JSON.parse(body)
  if(kind==='trial-balance')assert.deepEqual([value.debit,value.credit,value.balanced],[12500000,12500000,true])
  if(kind==='profit-and-loss')assert.equal(value.netIncome,-12500000)
  if(kind==='cash-flow')assert.deepEqual([value.operating.find(l=>l.id==='net-income').amount,value.netChange,value.ties],[-12500000,0,true])
  if(kind==='general-ledger')assert.equal(value.accounts.reduce((n,a)=>n+a.rows.length,0),250000)
 }
 console.log(JSON.stringify(measurements.at(-1)))
 } catch(error) {
  failures.push({kind,basis,failure:error instanceof assert.AssertionError ? error.message : 'hosted_report_request_failed'})
 }
}
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),head)
await writeFile(args[3],JSON.stringify({runId,head,inventory,custody,objectCount,objectBytes,measurements,failures,status:failures.length?'failed':'passed'},null,2)+'\n',{mode:0o600})
assert.deepEqual(failures,[],'Every hosted report must complete under three seconds')
