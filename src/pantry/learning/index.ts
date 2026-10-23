// Narrow recommendations from this business's actual, human-filed exceptions.
import { authority,who } from '../access'
import { nativeApprovalAuthority } from '../access-policy/approvals'
import { standingAuthority } from '../access-policy/banks'
import type { Command,Context } from '../context'
import { addDays,cents,date,now,requireThat,text,uid,type Data } from '../core'
import { all,audit,changed,guard,one,q,run,type Sql } from '../db'
import { payeeKey } from '../rules'
import { saveRecognition } from '../recognition/commands'
const normalized=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
function accountant(c:Context){requireThat(c.actor.kind==='person'&&['owner','accountant'].includes(c.actor.role),'An owner or accountant reviews learned schedules',403)}

/** Resolve vendor identity through a saved exact name or a confirmed alias. */
async function history(db:D1Database):Promise<Data[]>{
 const vendors=await all(db,"SELECT id,name FROM pt_contacts WHERE kind='vendor' AND active=1"),aliases=await all(db,'SELECT vendor_id,alias FROM pt_vendor_aliases')
 const rows=await all(db,`SELECT q.id AS question_id,q.revision AS question_revision,q.answer,q.answered_at,l.*,j.id AS source_journal_id,j.entry_date,jl.account_id AS balance_account_id,jl.debit_cents AS funded_cents FROM pt_questions q
 JOIN pt_bank_lines l ON l.id=q.subject_id JOIN pt_matches m ON m.id=q.result_id AND m.status='approved'
 JOIN pt_match_postings mp ON mp.match_id=m.id AND mp.active=1 JOIN pt_journal_lines bank ON bank.id=mp.journal_line_id
 JOIN pt_journal_entries j ON j.id=bank.entry_id AND j.status='posted' AND j.reversed_by_id IS NULL
 JOIN pt_journal_lines jl ON jl.entry_id=j.id AND jl.debit_cents>0 JOIN pt_accounts a ON a.id=jl.account_id AND a.type='asset' AND a.subtype='other'
 WHERE q.kind='unfiled' AND q.status='filed' AND q.result_kind='match' AND l.amount_cents<0 AND l.removed_at IS NULL AND l.excluded_at IS NULL ORDER BY l.posted_date,q.id`)
 return rows.flatMap((r:Data):Data[]=>{const keys=[r.payee,r.description,payeeKey(r)].filter(Boolean).map(normalized),matches=vendors.filter(v=>keys.includes(normalized(v.name))||aliases.some(a=>a.vendor_id===v.id&&keys.includes(normalized(a.alias))))
  return matches.length===1?[{...r,vendor_id:matches[0].id,vendor_name:matches[0].name}]:[]})
}
async function proposal(db:D1Database,id:string){const p=await one(db,'SELECT * FROM pt_learned_recognition WHERE id=?',id);requireThat(p,'Learned recommendation not found',404);return p}
const month=(day:string)=>Number(day.slice(0,4))*12+Number(day.slice(5,7))
function monthEnd(day:string,n:number){const [y,m]=day.split('-').map(Number);return new Date(Date.UTC(y,m+n,0)).toISOString().slice(0,10)}

export async function discoverLearning(db:D1Database){
 const rows=await history(db),groups=new Map<string,Data[]>()
 for(const r of rows){const key=r.vendor_id+':'+r.balance_account_id;const group=groups.get(key)??[];if(!group.some(x=>x.question_id===r.question_id))group.push(r);groups.set(key,group)}
 const writes:Sql[]=[]
 for(const group of groups.values()){
  if(group.length<3)continue
  const last=group.slice(-3),intervals=[month(last[1].posted_date)-month(last[0].posted_date),month(last[2].posted_date)-month(last[1].posted_date)]
  if(intervals[0]!==intervals[1]||intervals[0]<1||intervals[0]>12)continue
  const first=last[0],id=uid(),evidence=last.map(r=>({questionId:r.question_id,revision:r.question_revision,answer:r.answer,sourceJournalId:r.source_journal_id,date:r.posted_date,amount:r.funded_cents}))
  writes.push(q("INSERT OR IGNORE INTO pt_learned_recognition(id,vendor_id,balance_account_id,months,evidence,status,created_at,revision)VALUES(?,?,?,?,?,'proposed',?,?)",id,first.vendor_id,first.balance_account_id,intervals[0],JSON.stringify(evidence),now(),uid()))
 }
 if(writes.length)await run(db,writes)
}
async function backtest(db:D1Database,p:Data,recognition:string,asOf:string){
 const start=new Date(asOf+'T12:00:00Z');start.setUTCFullYear(start.getUTCFullYear()-1);const from=start.toISOString().slice(0,10)
 const sources=(await history(db)).filter(r=>r.vendor_id===p.vendor_id&&r.balance_account_id===p.balance_account_id&&r.posted_date>=from&&r.posted_date<=asOf)
 const proposed:Data[]=[]
 for(const source of sources){const part=Math.floor(source.funded_cents/p.months);for(let n=0;n<p.months;n++){const day=monthEnd(source.posted_date,n);if(day>=from&&day<=asOf)proposed.push({date:day,amount:n===p.months-1?source.funded_cents-part*(p.months-1):part,sourceJournalId:source.source_journal_id})}}
 const actual=await all(db,`SELECT e.id,e.entry_date AS date,l.debit_cents-l.credit_cents AS amount FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id WHERE e.status='posted' AND e.reversed_by_id IS NULL AND l.account_id=? AND l.contact_id=? AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date,e.id`,recognition,p.vendor_id,from,asOf)
 const months=[...new Set([...proposed.map(r=>r.date.slice(0,7)),...actual.map(r=>r.date.slice(0,7))])].sort().map(month=>{const expected=proposed.filter(r=>r.date.startsWith(month)).reduce((n,r)=>n+r.amount,0),recorded=actual.filter(r=>r.date.startsWith(month)).reduce((n,r)=>n+r.amount,0);return {month,proposed:expected,actual:recorded,difference:expected-recorded}})
 return {from,to:asOf,proposed,actual,months,scope:'Only source-funded exceptions for this exact confirmed vendor and balance account; actual expense lines require the same saved vendor contact. Unattributed expense is not assumed to be this vendor.'}
}
export async function learningView(db:D1Database){const proposals=await all(db,'SELECT p.*,v.name AS vendor,a.name AS balance_account FROM pt_learned_recognition p JOIN pt_contacts v ON v.id=p.vendor_id JOIN pt_accounts a ON a.id=p.balance_account_id ORDER BY p.created_at,p.id'),funds=await history(db)
 for(const p of proposals){p.evidence=JSON.parse(p.evidence);p.backtest=JSON.parse(p.backtest);p.sources=funds.filter(r=>r.vendor_id===p.vendor_id&&r.balance_account_id===p.balance_account_id).map(r=>({id:r.source_journal_id,date:r.entry_date,amount:r.funded_cents,questionId:r.question_id}));p.applications=await all(db,'SELECT x.*,s.status,s.revision,s.approved_revision FROM pt_learned_applications x JOIN pt_recognition_schedules s ON s.id=x.schedule_id WHERE x.proposal_id=? ORDER BY x.applied_at',p.id)}
 return {proposals}
}
const check:Command={need:'record',async run(c){accountant(c);await run(c.db,[authority(c.actor,'record')]);await discoverLearning(c.db);return learningView(c.db)}}
const preview:Command={need:'record',async run(c,b){accountant(c);const p=await proposal(c.db,text(b.id,'Recommendation'));requireThat(p.revision===b.revision,'Recommendation changed; reload',409);const account=await one(c.db,"SELECT id FROM pt_accounts WHERE id=? AND type='expense' AND active=1",text(b.recognitionAccountId,'Recognition expense'));requireThat(account,'Choose an active expense account');return backtest(c.db,p,account.id,date(b.asOf??new Date().toISOString().slice(0,10),'Back-test through'))}}
const approve:Command={need:'post',async run(c,b){accountant(c);const p=await proposal(c.db,text(b.id,'Recommendation'));requireThat(p.revision===b.revision&&p.status==='proposed','Review the current proposed revision',409);requireThat(b.vendorId===p.vendor_id,'Approval is narrowed to the one proposed vendor')
 const maximum=cents(b.maxAmount,'Maximum source amount'),test=await preview.run(c,b),reviewed=JSON.stringify(test);requireThat(b.backtest===reviewed,'The back-test changed; review it again before approval',409)
 const revision=uid();await run(c.db,[authority(c.actor,'post'),...nativeApprovalAuthority(c.actor,'journal',maximum),q("UPDATE pt_learned_recognition SET status='approved',max_cents=?,recognition_account_id=?,backtest=?,approved_by=?,revision=?,approved_revision=? WHERE id=? AND revision=? AND status='proposed'",maximum,b.recognitionAccountId,reviewed,c.actor.email,revision,revision,p.id,b.revision),changed(),audit(who(c.actor),'learned-recognition.approve','learned-recognition',p.id,{vendorId:p.vendor_id,maximum,months:p.months,backtest:test,preparesOnly:true})]);return learningView(c.db)
}}
const revoke:Command={need:'post',async run(c,b){accountant(c);const p=await proposal(c.db,text(b.id,'Recommendation'));await run(c.db,[authority(c.actor,'post'),q("UPDATE pt_learned_recognition SET status='revoked',revision=?,approved_revision=NULL WHERE id=? AND revision=?",uid(),p.id,b.revision),changed(),audit(who(c.actor),'learned-recognition.revoke','learned-recognition',p.id,{existingPlans:'Retained under their independent CLOSE-002 approvals'})]);return learningView(c.db)}}
const apply:Command={need:'record',async run(c,b){accountant(c);const p=await proposal(c.db,text(b.id,'Recommendation'));requireThat(p.status==='approved'&&p.revision===b.revision&&p.approved_revision===p.revision,'Approve this exact recommendation before preparing a plan',409)
 const source=(await history(c.db)).find(r=>r.vendor_id===p.vendor_id&&r.balance_account_id===p.balance_account_id&&r.source_journal_id===b.sourceJournalId);requireThat(source&&source.funded_cents<=p.max_cents,'Source is outside the approved vendor, account or materiality',409)
 const live=standingAuthority(p.approved_by,'journal',[],[p.balance_account_id,p.recognition_account_id]);requireThat(await one(c.db,`SELECT 1 WHERE ${live.sql}`,...live.params),'The recommendation approver no longer holds the posting grant',409)
 const fence=guard("EXISTS(SELECT 1 FROM pt_learned_recognition WHERE id=? AND revision=? AND status='approved' AND approved_revision=revision) AND ("+live.sql+')',p.id,p.revision,...live.params)
 const s=await saveRecognition(c,{kind:'prepaid',name:`Learned ${source.vendor_name} · ${source.posted_date}`,amount:(source.funded_cents/100).toFixed(2),startDate:monthEnd(source.posted_date,0),months:p.months,balanceAccountId:p.balance_account_id,recognitionAccountId:p.recognition_account_id,sourceJournalId:source.source_journal_id},s=>[fence,q('INSERT INTO pt_learned_applications VALUES(?,?,?,?,?)',p.id,s.id,source.source_journal_id,c.actor.email,now()),audit(who(c.actor),'learned-recognition.prepare','learned-recognition',p.id,{scheduleId:s.id,revision:s.revision,sourceJournalId:source.source_journal_id,needs:'Ordinary independent human CLOSE-002 posting approval'})]);return s
}}
export const learningCommands:Record<string,Command>={'learned.check':check,'learned.preview':preview,'learned.approve':approve,'learned.revoke':revoke,'learned.prepare':apply}
