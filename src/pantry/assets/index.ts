import { businessDay,sendingSettings } from '../delivery'
import { recurringJournal } from '../recurring-journals'
import { generateJournalOccurrence } from '../recurring-journal-runs'
import { authority, who } from '../access'
import { nativeApprovalAuthority } from '../access-policy/approvals'
import { ledgerBankAuthority } from '../access-policy/banks'
import type { Command,Context } from '../context'
import { cents,date,list,now,requireThat,text,uid,type Data } from '../core'
import { all,approval,audit,changed,guard,one,periodOpen,q,run,type Sql } from '../db'
import { entryStatements,parseLines,type Line } from '../journal'
import { dimensionTags } from '../dimensions'

function accountant(c:Context){requireThat(c.actor.kind==='person'&&['owner','accountant'].includes(c.actor.role),'An owner or accountant reviews asset accounting',403)}
async function get(db:D1Database,id:string){const a=await one(db,'SELECT * FROM pt_assets WHERE id=?',id);requireThat(a,'Asset not found',404);return a}
const input=(lines:Line[])=>lines.map(l=>({...l,debit:(l.debit/100).toFixed(2),credit:(l.credit/100).toFixed(2)}))
const assetSource=(a:Data)=>guard(`EXISTS(SELECT 1 FROM pt_journal_entries WHERE id=? AND status='posted' AND reversed_by_id IS NULL) AND (? IS NULL OR EXISTS(SELECT 1 FROM pt_journal_entries WHERE id=? AND status='posted' AND reversed_by_id IS NULL))`,a.source_journal_id,a.capitalization_journal_id,a.capitalization_journal_id)
export async function assetAmounts(db:D1Database,id:string){
 const rows=await all(db,`SELECT j.id,j.entry_date,j.reversed_by_id,d.occurrence,d.amount_cents FROM pt_asset_depreciation d JOIN pt_recurring_journal_runs r ON r.recurring_id=d.recurring_id JOIN pt_journal_entries j ON j.id=r.journal_id WHERE d.asset_id=? AND j.status='posted' ORDER BY j.entry_date,j.id`,id)
 const current=rows.filter(r=>!r.reversed_by_id)
 return {rows,accumulated:current.reduce((n,r)=>n+r.amount_cents,0),lastDate:current.at(-1)?.entry_date??null}
}
export async function assetView(db:D1Database){
 const assets=await all(db,'SELECT * FROM pt_assets ORDER BY placed_date,id')
 for(const a of assets){a.depreciation=await assetAmounts(db,a.id);a.bookValue=a.cost_cents-a.depreciation.accumulated;a.plan=await all(db,'SELECT d.*,t.revision,t.status,t.approved_revision FROM pt_asset_depreciation d JOIN pt_recurring_journals t ON t.id=d.recurring_id WHERE d.asset_id=? ORDER BY d.occurrence',a.id);a.tax=await one(db,'SELECT * FROM pt_asset_tax WHERE asset_id=?',a.id);if(a.tax)a.tax.schedule=JSON.parse(a.tax.schedule)}
 const settings=(await one(db,'SELECT * FROM pt_asset_settings WHERE id=1'))!
 const proposals=settings.threshold_cents==null?[]:await all(db,`SELECT l.*,b.reference,b.bill_date,b.revision AS bill_revision,c.name AS vendor FROM pt_bill_lines l JOIN pt_bills b ON b.id=l.bill_id JOIN pt_contacts c ON c.id=b.vendor_id JOIN pt_accounts a ON a.id=l.account_id JOIN pt_journal_entries j ON j.id=b.journal_id WHERE b.status='posted' AND j.reversed_by_id IS NULL AND l.amount_cents>? AND a.type IN('expense','asset') AND NOT EXISTS(SELECT 1 FROM pt_assets x WHERE x.bill_line_id=l.id) ORDER BY b.bill_date,l.id`,settings.threshold_cents)
 return {settings,assets,proposals}
}
const settings:Command={need:'record',async run(c,b){accountant(c);const threshold=cents(b.threshold,'Capitalization threshold',{zero:true}),year=Number(b.taxYear);requireThat(Number.isInteger(year)&&year>=2000&&year<=9999,'Choose the election tax year');const election=text(b.safeHarbor,'Recorded de minimis election',1000),revision=uid()
 await run(c.db,[authority(c.actor,'record'),q('UPDATE pt_asset_settings SET threshold_cents=?,safe_harbor=?,tax_year=?,revision=? WHERE id=1 AND revision=?',threshold,election,year,revision,b.revision),changed(),audit(who(c.actor),'asset.settings','asset-settings','1',{threshold,safeHarbor:election,taxYear:year})]);return assetView(c.db)
}}
const register:Command={need:'post',async run(c,b){accountant(c);requireThat(c.actor.kind==='person'&&c.actor.role==='owner','Owner approval is required for capitalization',403);requireThat(b.confirm===true,'Review and explicitly confirm capitalization')
 const source=await one(c.db,`SELECT l.*,b.journal_id,b.revision AS bill_revision,b.bill_date,b.status FROM pt_bill_lines l JOIN pt_bills b ON b.id=l.bill_id WHERE l.id=?`,text(b.billLineId,'Source bill line'));requireThat(source?.status==='posted'&&source.bill_revision===b.billRevision,'Review the current posted source bill',409)
 const cost=source.amount_cents;requireThat(cents(b.cost,'Reviewed cost')===cost,'Source cost changed; review again',409)
 const residual=cents(b.residual??'0','Residual value',{zero:true}),months=Number(b.months),placed=date(b.placedDate,'Placed in service')
 requireThat(residual<cost&&Number.isInteger(months)&&months>=1&&months<=1200,'Use residual below cost and a life of 1–1200 months')
 requireThat(placed>=source.bill_date,'Placed-in-service date cannot precede the source bill')
 requireThat(['straight-line','declining-balance'].includes(b.method),'Choose straight-line or double declining balance')
 const assetAccount=text(b.assetAccountId,'Asset account'),accumulated=text(b.accumulatedAccountId,'Accumulated depreciation'),expense=text(b.expenseAccountId,'Depreciation expense')
 requireThat(new Set([assetAccount,accumulated,expense]).size===3,'Choose distinct asset, accumulated depreciation and expense accounts')
 const accounts=await all(c.db,'SELECT * FROM pt_accounts WHERE id IN(?,?,?)',assetAccount,accumulated,expense)
 requireThat(accounts.find(a=>a.id===assetAccount&&a.type==='asset'&&a.subtype==='other'&&a.active)&&accounts.find(a=>a.id===accumulated&&a.type==='asset'&&a.subtype==='other'&&a.active)&&accounts.find(a=>a.id===expense&&a.type==='expense'&&a.active),'Choose active fixed-asset and contra-asset accounts and a depreciation expense account')
 const id=uid(),revision=uid(),capId=source.account_id===assetAccount?null:uid(),name=text(b.name,'Asset name',200),tags=dimensionTags(source),statements:Sql[]=[authority(c.actor,'post'),...nativeApprovalAuthority(c.actor,'journal',cost),periodOpen(placed),guard("EXISTS(SELECT 1 FROM pt_bills b JOIN pt_journal_entries j ON j.id=b.journal_id WHERE b.id=? AND b.revision=? AND b.status='posted' AND j.reversed_by_id IS NULL)",source.bill_id,b.billRevision)]
 if(capId){const lines=await parseLines(c.db,input([{...tags,accountId:assetAccount,debit:cost,credit:0},{...tags,accountId:source.account_id,debit:0,credit:cost}]))
  statements.push(...entryStatements({id:capId,revision,date:placed,memo:`Capitalize ${name}`,sourceKind:'manual',sourceId:id,preparedBy:c.actor.email,preparedKind:'person',lines},c.actor.email),approval(who(c.actor),'journal',capId,revision,'post','approved','Explicit capitalization of the reviewed source bill line'))
 }
 statements.push(q(`INSERT INTO pt_assets(id,name,bill_id,bill_line_id,source_journal_id,capitalization_journal_id,cost_cents,residual_cents,placed_date,months,method,asset_account_id,accumulated_account_id,expense_account_id,class_name,location_name,project_name,created_by,created_at,revision)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,name,source.bill_id,source.id,source.journal_id,capId,cost,residual,placed,months,b.method,assetAccount,accumulated,expense,tags.className??'',tags.locationName??'',tags.projectName??'',c.actor.email,now(),revision),assetSource({...source,source_journal_id:source.journal_id,capitalization_journal_id:capId}),audit(who(c.actor),'asset.capitalize','asset',id,{cost,sourceBillId:source.bill_id,sourceBillLineId:source.id,capitalizationJournalId:capId,method:b.method,months,residual}))
 await run(c.db,statements);return get(c.db,id)
}}
function monthEnd(start:string,n:number){const [year,month]=start.split('-').map(Number);return new Date(Date.UTC(year,month+n,0)).toISOString().slice(0,10)}
export function depreciationPlan(a:Data){let remaining=a.cost_cents;const depreciable=a.cost_cents-a.residual_cents,plan:{date:string;amount:number}[]=[]
 for(let n=0;n<a.months;n++){const amount=Math.min(remaining-a.residual_cents,n===a.months-1?remaining-a.residual_cents:a.method==='straight-line'?Math.floor(depreciable/a.months):Math.floor(remaining*2/a.months));if(amount>0){plan.push({date:monthEnd(a.placed_date,n),amount});remaining-=amount}}
 return plan
}
const prepare:Command={need:'record',async run(c,b){accountant(c);const a=await get(c.db,text(b.id,'Asset'));requireThat(a.revision===b.revision&&!a.disposed_date,'Asset changed or disposed',409)
 const plan=depreciationPlan(a),existing=await all(c.db,'SELECT occurrence FROM pt_asset_depreciation WHERE asset_id=?',a.id),missing=plan.filter(p=>!existing.some(e=>e.occurrence===p.date)).slice(0,24),statements:Sql[]=[authority(c.actor,'record'),assetSource(a),guard('EXISTS(SELECT 1 FROM pt_assets WHERE id=? AND revision=? AND disposed_date IS NULL)',a.id,b.revision)]
 for(const p of missing){const id=uid(),revision=uid(),lines=await parseLines(c.db,input([{...dimensionTags(a),accountId:a.expense_account_id,debit:p.amount,credit:0},{...dimensionTags(a),accountId:a.accumulated_account_id,debit:0,credit:p.amount}]))
  statements.push(q(`INSERT INTO pt_recurring_journals(id,name,memo,lines,every,cadence,start_date,end_date,next_date,mode,status,prepared_by,revision,created_at,updated_at)VALUES(?,?,?,?,1,'month',?,?,?,'post','awaiting-approval',?,?,?,?)`,id,`${a.name} · ${p.date}`,`Book depreciation · ${a.name}`,JSON.stringify(lines),p.date,p.date,p.date,c.actor.email,revision,now(),now()),q('INSERT INTO pt_asset_depreciation VALUES(?,?,?,?)',a.id,p.date,p.amount,id))
 }
 statements.push(audit(who(c.actor),'asset.prepare-depreciation','asset',a.id,{prepared:missing.length,remaining:plan.length-existing.length-missing.length,needs:'Each template requires ordinary CLOSE-001 exact-revision approval'}));await run(c.db,statements);return assetView(c.db)
}}
const dispose:Command={need:'post',async run(c,b){accountant(c);requireThat(c.actor.kind==='person'&&c.actor.role==='owner','Owner approval is required for disposal',403);requireThat(b.confirm===true,'Explicitly confirm the reviewed disposal')
 const a=await get(c.db,text(b.id,'Asset')),amounts=await assetAmounts(c.db,a.id),day=date(b.date,'Disposal date'),proceeds=cents(b.proceeds,'Proceeds',{zero:true}),bank=text(b.bankAccountId,'Cash ledger account'),gain=text(b.gainAccountId,'Gain account'),loss=text(b.lossAccountId,'Loss account')
 requireThat(a.revision===b.revision&&!a.disposed_date&&Number(b.accumulatedCents)===amounts.accumulated,'Asset or depreciation changed; review disposal again',409)
 requireThat(day>=a.placed_date&&(!amounts.lastDate||day>=amounts.lastDate),'Reverse later depreciation before an earlier disposal')
 const accounts=await all(c.db,'SELECT * FROM pt_accounts WHERE id IN(?,?,?)',bank,gain,loss)
 requireThat(accounts.some(x=>x.id===bank&&x.type==='asset'&&x.subtype==='bank'&&x.active)&&accounts.some(x=>x.id===gain&&x.type==='income'&&x.active)&&accounts.some(x=>x.id===loss&&x.type==='expense'&&x.active),'Choose active bank, gain-income and loss-expense accounts')
 const difference=proceeds-(a.cost_cents-amounts.accumulated),tags=dimensionTags(a),raw:Line[]=[{...tags,accountId:a.asset_account_id,debit:0,credit:a.cost_cents}]
 if(proceeds)raw.push({...tags,accountId:bank,debit:proceeds,credit:0});if(amounts.accumulated)raw.push({...tags,accountId:a.accumulated_account_id,debit:amounts.accumulated,credit:0});if(difference)raw.push({...tags,accountId:difference>0?gain:loss,debit:difference<0?-difference:0,credit:difference>0?difference:0})
 const lines=await parseLines(c.db,input(raw)),id=uid(),revision=uid()
 await run(c.db,[authority(c.actor,'post'),...nativeApprovalAuthority(c.actor,'journal',lines.reduce((n,l)=>n+l.debit,0)),...await ledgerBankAuthority(c.db,c.actor,[bank],'post'),assetSource(a),periodOpen(day),guard(`COALESCE((SELECT SUM(d.amount_cents) FROM pt_asset_depreciation d JOIN pt_recurring_journal_runs r ON r.recurring_id=d.recurring_id JOIN pt_journal_entries j ON j.id=r.journal_id WHERE d.asset_id=? AND j.status='posted' AND j.reversed_by_id IS NULL),0)=?`,a.id,amounts.accumulated),guard('EXISTS(SELECT 1 FROM pt_assets WHERE id=? AND revision=? AND disposed_date IS NULL)',a.id,b.revision),...entryStatements({id,revision,date:day,memo:`Dispose ${a.name}`,sourceKind:'manual',sourceId:a.id,preparedBy:c.actor.email,preparedKind:'person',lines},c.actor.email),q('UPDATE pt_assets SET disposed_date=?,disposal_journal_id=?,revision=? WHERE id=? AND revision=? AND disposed_date IS NULL',day,id,uid(),a.id,b.revision),changed(),approval(who(c.actor),'journal',id,revision,'post','approved','Explicit reviewed disposal'),q("UPDATE pt_recurring_journals SET status='paused' WHERE id IN(SELECT recurring_id FROM pt_asset_depreciation WHERE asset_id=? AND occurrence>=?) AND status IN('active','awaiting-approval')",a.id,day),audit(who(c.actor),'asset.dispose','asset',a.id,{date:day,proceeds,accumulated:amounts.accumulated,bookValue:a.cost_cents-amounts.accumulated,gainOrLoss:difference,journalId:id})]);return get(c.db,a.id)
}}
const tax:Command={need:'record',async run(c,b){accountant(c);const a=await get(c.db,text(b.id,'Asset')),year=Number(b.year),section=cents(b.section179??'0','Section 179',{zero:true}),bonus=cents(b.bonus??'0','Bonus depreciation',{zero:true}),method=text(b.method,'Tax method'),note=text(b.note,'Accountant election note',2000)
 requireThat(Number.isInteger(year)&&year>=Number(a.placed_date.slice(0,4))&&year<=9999,'Choose a tax year on or after placed in service');requireThat(['none','MACRS','accountant-entered'].includes(method),'Choose the accountant-selected tax method')
 const schedule=list<Data>(b.schedule??[],'Tax schedule',100).map(r=>({year:Number(r.year),amount:cents(r.amount,'Annual tax depreciation',{zero:true})}))
 requireThat(schedule.every(r=>Number.isInteger(r.year)&&r.year>=year&&r.year<=9999)&&new Set(schedule.map(r=>r.year)).size===schedule.length,'Each schedule year must be unique and on or after the election year')
 requireThat(section+bonus+schedule.reduce((n,r)=>n+r.amount,0)<=a.cost_cents,'Tax deductions cannot exceed the recorded cost')
 const old=await one(c.db,'SELECT * FROM pt_asset_tax WHERE asset_id=?',a.id);requireThat(!old||old.revision===b.taxRevision,'Tax election changed; reload',409)
 const revision=uid();await run(c.db,[authority(c.actor,'record'),...(old?[q('UPDATE pt_asset_tax SET election_year=?,section179_cents=?,bonus_cents=?,method=?,schedule=?,note=?,updated_by=?,updated_at=?,revision=? WHERE asset_id=? AND revision=?',year,section,bonus,method,JSON.stringify(schedule),note,c.actor.email,now(),revision,a.id,b.taxRevision),changed()]:[q('INSERT INTO pt_asset_tax VALUES(?,?,?,?,?,?,?,?,?,?)',a.id,year,section,bonus,method,JSON.stringify(schedule),note,c.actor.email,now(),revision)]),audit(who(c.actor),'asset.tax-election','asset',a.id,{before:old,after:{year,section179:section,bonus,method,schedule,note},posts:false})]);return assetView(c.db)
}}
export async function taxDepreciation(db:D1Database,year:number){const rows=await all(db,'SELECT t.*,a.name,a.cost_cents,a.placed_date FROM pt_asset_tax t JOIN pt_assets a ON a.id=t.asset_id');return rows.map((r:Data):Data=>({...r,schedule:JSON.parse(r.schedule)})).filter(r=>r.election_year===year||r.schedule.some((s:Data)=>s.year===year)).map(r=>({...r,taxYear:year,annualAmount:(r.election_year===year?r.section179_cents+r.bonus_cents:0)+r.schedule.filter((s:Data)=>s.year===year).reduce((n:number,s:Data)=>n+s.amount,0),basis:'Accountant-selected tax schedule; never posted to the ledger'}))}
const runApproved:Command={need:'record',async run(c,b){accountant(c);const a=await get(c.db,text(b.id,'Asset')),day=businessDay((await sendingSettings(c.db)).time_zone)
 await run(c.db,[authority(c.actor,'record')]);const due=await all(c.db,"SELECT d.recurring_id,d.occurrence FROM pt_asset_depreciation d JOIN pt_recurring_journals t ON t.id=d.recurring_id WHERE d.asset_id=? AND t.status='active' AND t.next_date<=? ORDER BY d.occurrence LIMIT 24",a.id,day)
 for(const d of due){const t=await recurringJournal(c.db,d.recurring_id);await generateJournalOccurrence(c.db,t,d.occurrence,day,{authority:authority(c.actor,'record')})}
 return assetView(c.db)
}}
export const assetCommands:Record<string,Command>={'asset.run':runApproved,'asset.settings':settings,'asset.capitalize':register,'asset.prepare-depreciation':prepare,'asset.dispose':dispose,'asset.tax-election':tax}
