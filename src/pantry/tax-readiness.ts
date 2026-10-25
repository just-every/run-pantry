import type { Command, Context } from './context'
import { authority, who } from './access'
import { cents, date, now, requireThat, text, uid } from './core'
import { all, audit, changed, one, q, run } from './db'
import { missingW9 } from './w9'
import { nexusWatch } from './nexus'
import { yearEndState } from './year-end'
import { accountantPackage } from './package'
function taxReader(c:Context){requireThat(c.actor.kind==='person'&&['owner','accountant'].includes(c.actor.role),'Only the owner or accountant reviews tax readiness',403)}
export async function taxReadiness(c:Context,year:number){
 taxReader(c);requireThat(Number.isInteger(year)&&year>=2000&&year<=2100,'Choose a tax year')
 const today=now().slice(0,10),nexus=await nexusWatch(c.db),deadlines=await all(c.db,'SELECT * FROM pt_tax_deadlines WHERE due_date BETWEEN ? AND ? ORDER BY due_date,id',`${year}-01-01`,`${year+1}-12-31`)
 const statutory={id:`nec-${year}`,label:`Review ${year} 1099-NEC recipient and federal filing deadline with accountant`,due_date:`${year+1}-01-31`,amount_cents:null,completed_at:null,source:'Recorded 1099 calendar; verify weekend, holiday and jurisdiction rules before filing'}
 const calendar=[statutory,...deadlines].map(d=>({...d,reminder:!d.completed_at&&d.due_date<=new Date(Date.now()+30*86400000).toISOString().slice(0,10),overdue:!d.completed_at&&d.due_date<today}))
 return {year,today,w9Proposals:(await missingW9(c.db,year)).map(v=>({contactId:v.id,name:v.name,paid:v.payments.filter(p=>!p.reversed).reduce((s,p)=>s+p.amount,0),status:v.w9.status,summary:`Request a W-9 from ${v.name}`,requiresOwnerApproval:true})),nexus:nexus.states.filter(s=>s.level>=80),deadlines:calendar,note:'Readiness signals only. The accountant owns tax decisions and sets all estimated amounts and due dates. No automatic request or payment is sent.'}
}
const deadline:Command={need:'record',async run(c,b){taxReader(c);requireThat(c.actor.kind==='person'&&c.actor.role==='accountant','Only the accountant sets tax deadlines',403);const id=b.id?text(b.id,'Deadline'):uid(),old=await one(c.db,'SELECT * FROM pt_tax_deadlines WHERE id=?',id);if(old)requireThat(old.revision===b.revision,'Deadline changed; reload',409)
 const label=text(b.label,'Deadline description',200),due=date(b.dueDate),amount=b.amount===''||b.amount===undefined?null:cents(b.amount,'Accountant estimated amount')
 requireThat(amount===null||amount>=0,'Amount cannot be negative')
 requireThat(c.actor.kind==='person'&&(c.actor.role==='accountant'||amount===null),'Only the accountant sets estimated-tax amounts',403)
 await run(c.db,[authority(c.actor,'record'),q('INSERT INTO pt_tax_deadlines(id,label,due_date,amount_cents,completed_at,revision,set_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,due_date=excluded.due_date,amount_cents=excluded.amount_cents,completed_at=excluded.completed_at,revision=excluded.revision,set_by=excluded.set_by WHERE pt_tax_deadlines.revision=?',id,label,due,amount,b.complete===true?now():null,uid(),c.actor.email,old?.revision??null),changed(),audit(who(c.actor),'tax.deadline','tax-deadline',id,{label,due,amount})]);return {id}}}
export const taxReadinessCommands:Record<string,Command>={'tax.deadline':deadline}
export async function taxYearPackage(c:Context,year:number){
 taxReader(c);const readiness=await taxReadiness(c,year),state=await yearEndState(c.db,year)
 const questions=await all(c.db,"SELECT id,subject_kind,subject_id,title,status,period FROM pt_questions WHERE status IN ('open','confirm') AND period BETWEEN ? AND ? ORDER BY asked_at",state.start.slice(0,7),state.end.slice(0,7))
 return {format:'pantry-tax-year-package/1',year,readiness,yearEnd:state,openQuestions:questions,accountantPackage:await accountantPackage(c.db,state.finalPeriod)}
}
