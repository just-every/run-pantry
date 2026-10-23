// Outside push Verify: node tests/api/search-scale.mjs --receipt /outside/repository/result.json
// Synthetic history is loaded directly into D1; each measured search uses
// the real authenticated HTTP door and the shared native behavioural scenario.
import { searchHarness,searchScenario } from './search-scenario.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve,relative } from 'node:path'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','Run the committed clean candidate')
const args=process.argv.slice(2);assert.ok(args.length===0||args.length===2&&args[0]==='--receipt','Use optional --receipt /outside/repository/result.json')
const receipt=args[1]?resolve(args[1]):null;if(receipt)assert.ok(relative(process.cwd(),receipt).startsWith('..'),'Keep run evidence outside the repository')
const h=await searchHarness(),measurements=[]
try{
 const {acct,inv,payment,bill,check}=await searchScenario(h)
 const baseline=await h.db.prepare("SELECT COUNT(*) AS n FROM pt_journal_lines l JOIN pt_journal_entries j ON j.id=l.entry_id WHERE j.status='posted'").first(),baselineDocs=await h.db.prepare('SELECT COUNT(*) AS n FROM pt_documents').first()
 const count=25000,batchSize=100,started=performance.now()
 for(let base=0;base<count;base+=batchSize){const commands=[]
  for(let n=base;n<Math.min(base+batchSize,count);n++){
   const id='synthetic-pantry-scale-journal-'+String(n).padStart(6,'0')
   commands.push(h.db.prepare("INSERT INTO pt_journal_entries(id,entry_date,memo,source_kind,status,prepared_by,prepared_kind,revision,created_at) VALUES(?,'2026-09-01','synthetic-pantry-scale-history','manual','draft','owner@example.test','person','synthetic-pantry-scale-revision','2026-09-01T00:00:00Z')").bind(id))
   for(let line=0;line<10;line++)commands.push(h.db.prepare("INSERT INTO pt_journal_lines(id,entry_id,line_no,account_id,debit_cents,credit_cents,memo) VALUES(?,?,?,?,?,?,?)").bind(id+'-'+line,id,line+1,line%2===0?acct['6200']:acct['3000'],line%2===0?100:0,line%2===1?100:0,'synthetic-pantry-scale-line'))
   commands.push(h.db.prepare("UPDATE pt_journal_entries SET status='posted',posted_by='owner@example.test',posted_at='2026-09-01T00:00:00Z' WHERE id=?").bind(id))
  }
  await h.db.batch(commands)
  if(base%5000===0)console.log('posted lines',Math.min(base+batchSize,count)*10)
 }
 const bytes=Buffer.from('%PDF-1.4\nsynthetic-pantry-scale-document\n%%EOF'),hash=createHash('sha256').update(bytes).digest('hex')
 for(let base=0;base<20000;base+=100){const commands=[];for(let n=base;n<base+100;n++)commands.push(h.db.prepare("INSERT INTO pt_documents(id,name,media_type,size,sha256,content,note,uploaded_by,uploaded_at) VALUES(?,?,'application/pdf',?,?,?,'synthetic-pantry-scale-note','owner@example.test','2026-09-01T00:00:00Z')").bind('synthetic-pantry-scale-document-'+n,'synthetic-pantry-scale-'+n+'.pdf',bytes.length,hash,bytes));await h.db.batch(commands)}
 console.log('seed milliseconds',Math.round(performance.now()-started))
 const posted=Number((await h.db.prepare("SELECT COUNT(*) AS n FROM pt_journal_lines l JOIN pt_journal_entries j ON j.id=l.entry_id WHERE j.status='posted'").first()).n),documents=Number((await h.db.prepare('SELECT COUNT(*) AS n FROM pt_documents').first()).n)
 assert.equal(posted,Number(baseline.n)+250000);assert.equal(documents,Number(baselineDocs.n)+20000)
 const cases=[...['1234.56','$1,234.56','1,234.56'].map(q=>({query:new URLSearchParams({q}).toString(),verify:rows=>{assert.ok(rows.some(r=>r.id===inv.id));assert.ok(rows.some(r=>r.id===payment.id));assert.ok(rows.some(r=>r.type==='bank-line'))}})),
 {query:'min=1200&max=1300',verify:rows=>{assert.ok(rows.some(r=>r.id===inv.id));assert.ok(rows.some(r=>r.id===payment.id));assert.ok(rows.some(r=>r.type==='bank-line'))}},
 {query:'q=1047&type=check',verify:rows=>assert.ok(rows.some(r=>r.id===check.checks[0].id&&String(r.number)==='1047'))},
 {query:'q=cedar%20wood',verify:rows=>assert.ok(rows.some(r=>r.id===bill.id))},
 {query:'q=synthetic-pantry-4%20alias',verify:rows=>assert.ok(rows.some(r=>r.id===bill.id))},
 {query:'q=synthetic-pantry-scale-19999.pdf',verify:rows=>assert.ok(rows.some(r=>r.type==='document'))}]
 for(const item of cases){const start=performance.now(),r=await h.view('search?'+item.query),elapsed=performance.now()-start,rows=r.groups.flatMap(g=>g.records);item.verify(rows);measurements.push({query:item.query,milliseconds:Math.round(elapsed),returned:rows.length});console.log(JSON.stringify(measurements.at(-1)));assert.ok(elapsed<1000,`Search took ${elapsed.toFixed(1)} ms; must answer within one second`)}
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),head,'Candidate changed during the run')
 const result={runId:'sx-pantry-c38-search-scale-01',head,postedLines:posted,documents,fixture:'Synthetic D1 history; shared native invoice/payment/feed/check/alias scenario; every measured query through authenticated HTTP; dedicated local VM, not a hosted Cloudflare measurement',measurements}
 if(receipt)await writeFile(receipt,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({runId:result.runId,head,postedLines:posted,documents,status:'passed'}))

}finally{await h.close()}
