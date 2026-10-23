import { authority,must,who } from '../access'
import type { Command,Context } from '../context'
import { cents,Fault,now,requireThat,text,uid,type Data } from '../core'
import { all,audit,changed,guard,one,q,run } from '../db'
import { fileStatements,rules,ruleMatches } from '../rules'
import { depositProposals } from '../automatch'
import { recordedPaymentCandidates } from '../recorded-payments'
const normalize=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
const system={email:'agent:pantry',kind:'agent' as const}
const owner=(c:Context)=>{must(c.actor,'owner');requireThat(c.actor.kind==='person','A native owner approves standing permissions',403)}
const grant:Command={need:'owner',async run(c,b){owner(c);requireThat(b.confirm===true,'Explicitly confirm this narrowly scoped standing permission')
 const rule=(await rules(c.db)).find(r=>r.id===b.ruleId&&r.revision===b.ruleRevision);requireThat(rule&&rule.mode==='suggest','Choose an existing suggest-only rule revision',409)
 const bank=text(b.bankAccountId,'Bank account');requireThat(await one(c.db,'SELECT id FROM pt_bank_accounts WHERE id=?',bank),'Choose a bank account');requireThat(!rule.bank_account_id||rule.bank_account_id===bank,'The bank must match the rule')
 const payee=normalize(text(b.payee,'Exact bank payee',200)),maximum=cents(b.maxAmount,'Maximum automatic amount'),id=uid(),revision=uid()
 requireThat(payee.length>0,'Enter the exact bank payee text')
 await run(c.db,[authority(c.actor,'owner'),guard('EXISTS(SELECT 1 FROM pt_bank_rules WHERE id=? AND revision=? AND active=1)',rule.id,rule.revision),q('INSERT INTO pt_agent_permissions VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)',id,text(b.name,'Permission name',100),'bank-rule',c.actor.id,c.actor.email,rule.id,rule.revision,bank,payee,maximum,now(),revision),audit(who(c.actor),'agent-permission.grant','agent-permission',id,{ruleId:rule.id,revision:rule.revision,bankAccountId:bank,payee,maximum,kind:'bank-rule'})]);return {id,revision}
}}
const revoke:Command={need:'owner',async run(c,b){owner(c);await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_agent_permissions SET active=0,revision=? WHERE id=? AND revision=? AND active=1',uid(),b.id,b.revision),changed(),audit(who(c.actor),'agent-permission.revoke','agent-permission',b.id,{futureActions:'Stopped; historical actions retained'})]);return standingView(c)}}
const review:Command={need:'owner',async run(c,b){owner(c);requireThat(['correct','changed'].includes(b.review),'Choose correct or needs correction');await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_agent_actions SET review=?,reviewed_by=?,reviewed_at=? WHERE id=? AND review IS NULL',b.review,c.actor.email,now(),b.id),changed(),audit(who(c.actor),'agent-action.review','agent-action',b.id,{review:b.review})]);return standingView(c)}}

/** A read-only candidate pass; every actual filing rechecks consent in its batch. */
export async function runStanding(db:D1Database,lineIds?:string[]){
 const permissions=await all(db,"SELECT p.* FROM pt_agent_permissions p JOIN oa_operators o ON o.id=p.owner_id AND o.role='owner' AND o.status='active' WHERE p.active=1 ORDER BY p.created_at,p.id")
 if(!permissions.length)return {filed:0}
 const active=await rules(db),lines=await all(db,`SELECT l.* FROM pt_bank_lines l WHERE l.removed_at IS NULL AND l.excluded_at IS NULL AND l.rules_off=0 AND NOT EXISTS(SELECT 1 FROM pt_match_bank_lines m WHERE m.bank_line_id=l.id AND m.active=1) AND NOT EXISTS(SELECT 1 FROM pt_agent_actions a WHERE a.bank_line_id=l.id) ${lineIds?'AND l.id IN(SELECT value FROM json_each(?))':''} ORDER BY l.posted_date,l.id`,...(lineIds?[JSON.stringify(lineIds)]:[]))
 const deposits=await depositProposals(db,lines),recorded=await recordedPaymentCandidates(db,lines);let filed=0
 for(const line of lines){
  if(filed>=200)break
  if(deposits[line.id]||recorded[line.id]?.length)continue
  const rule=active.find(r=>ruleMatches(r,line));if(!rule||rule.mode!=='suggest')continue
  const payee=normalize(line.payee||line.description),permission=permissions.find(p=>p.rule_id===rule.id&&p.rule_revision===rule.revision&&p.bank_account_id===line.bank_account_id&&p.payee===payee&&Math.abs(line.amount_cents)<=p.max_cents)
  if(!permission)continue
  try{await run(db,await fileStatements(db,rule,line,{actor:system,authority:guard('EXISTS(SELECT 1 FROM pt_agent_permissions WHERE id=? AND revision=? AND active=1)',permission.id,permission.revision),permission}));filed++}
  catch(e){if(!(e instanceof Fault&&e.status===409))throw e}
 }
 return {filed}
}
const execute:Command={need:'owner',async run(c){owner(c);await run(c.db,[authority(c.actor,'owner')]);return runStanding(c.db)}}
export async function standingView(c:Context){owner(c)
 const permissions=await all(c.db,'SELECT * FROM pt_agent_permissions ORDER BY created_at,id'),today=new Date(),monday=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()));monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7)
 const week=monday.toISOString().slice(0,10)
 for(const p of permissions){p.metrics=(await all(c.db,`SELECT COUNT(*) AS actions,COALESCE(SUM(CASE WHEN m.status='undone' THEN 1 ELSE 0 END),0) AS undone,COALESCE(SUM(CASE WHEN a.review IS NOT NULL THEN 1 ELSE 0 END),0) AS reviewed,COALESCE(SUM(CASE WHEN a.review='correct' THEN 1 ELSE 0 END),0) AS correct,COALESCE(SUM(CASE WHEN a.review='changed' THEN 1 ELSE 0 END),0) AS changed FROM pt_agent_actions a JOIN pt_matches m ON m.id=a.match_id WHERE a.permission_id=?`,p.id))[0]
  p.metrics.accuracy=p.metrics.reviewed?p.metrics.correct/p.metrics.reviewed:null
  p.sample=await all(c.db,`SELECT a.id,a.match_id,a.review,a.at,l.description,l.amount_cents,l.posted_date,m.status FROM pt_agent_actions a JOIN pt_bank_lines l ON l.id=a.bank_line_id JOIN pt_matches m ON m.id=a.match_id WHERE a.permission_id=? AND substr(a.at,1,10)>=? ORDER BY a.at,a.id LIMIT 5`,p.id,week)
 }
 return {permissions,week,sampleMethod:'First five actions per permission in the current UTC calendar week; one human review per action. Accuracy is correct human reviews divided by reviewed actions, not a model confidence.',rules:(await rules(c.db)).filter(r=>r.mode==='suggest').map(r=>({id:r.id,revision:r.revision,name:r.name}))}
}
export const standingCommands:Record<string,Command>={'agent-permission.grant':grant,'agent-permission.revoke':revoke,'agent-permission.run':execute,'agent-action.review':review}
