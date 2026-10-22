import { authority, who } from '../access'
import { optionalText, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, periodOpen, q, run } from '../db'
import type { Command } from '../context'

export const DIMENSIONS = ['class','location','project'] as const
export type DimensionKind = typeof DIMENSIONS[number]
export const dimensionTags = (b: Data) => ({className:optionalText(b.className??b.class_name,'Class',100),locationName:optionalText(b.locationName??b.location_name,'Location',100),projectName:optionalText(b.projectName??b.project_name,'Project',100)})
export const dimensionValues = (b: Data) => { const d=dimensionTags(b); return [d.className,d.locationName,d.projectName] }
export async function dimensionsView(db:D1Database) {
 return { settings:await one(db,'SELECT * FROM pt_dimension_settings WHERE id=1'), values:await all(db,'SELECT * FROM pt_dimensions ORDER BY kind,lower(name)'), required:await all(db,'SELECT * FROM pt_account_dimensions ORDER BY account_id,kind') }
}
const settings:Command={need:'owner',async run(c,b){
 const current=await one(c.db,'SELECT * FROM pt_dimension_settings WHERE id=1')
 requireThat(b.revision===current?.revision,'Dimension settings changed; reload',409)
 const enabled=DIMENSIONS.map(kind=>b[kind]===true?1:0)
 await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_dimension_settings SET classes_enabled=?,locations_enabled=?,projects_enabled=?,revision=? WHERE id=1 AND revision=?',...enabled,uid(),b.revision),changed(),audit(who(c.actor),'dimensions.settings','dimension-settings','1',{before:current,after:{class:!!enabled[0],location:!!enabled[1],project:!!enabled[2]}})])
 return dimensionsView(c.db)
}}
const save:Command={need:'owner',async run(c,b){
 const kind=text(b.kind,'Dimension kind') as DimensionKind
 requireThat(DIMENSIONS.includes(kind),'Dimension is class, location or project')
 const id=b.id?text(b.id,'Dimension'):uid(),name=text(b.name,'Dimension name',100),active=b.active===false?0:1
 const before=b.id?await one(c.db,'SELECT * FROM pt_dimensions WHERE id=?',id):null
 requireThat(!b.id||before&&before.revision===b.revision&&before.kind===kind,'Dimension changed; reload',409)
 // Names already carried by immutable postings do not get silently renamed.
 requireThat(!before||before.name===name,'Dimension names are retained; add a new value and deactivate the old one',409)
 await run(c.db,[authority(c.actor,'owner'),...(before?[q('UPDATE pt_dimensions SET active=?,revision=? WHERE id=? AND revision=?',active,uid(),id,b.revision),changed()]:[q('INSERT INTO pt_dimensions(id,kind,name,active,revision)VALUES(?,?,?,?,?)',id,kind,name,active,uid())]),audit(who(c.actor),'dimension.save','dimension',id,{before,after:{kind,name,active}})])
 return (await one(c.db,'SELECT * FROM pt_dimensions WHERE id=?',id))!
}}
const required:Command={need:'owner',async run(c,b){
 const accountId=text(b.accountId,'Account'),account=await one(c.db,'SELECT * FROM pt_accounts WHERE id=? AND active=1',accountId)
 requireThat(account,'Choose an active account')
 const kinds=Array.isArray(b.kinds)?b.kinds:[]
 requireThat(kinds.every(k=>DIMENSIONS.includes(k))&&new Set(kinds).size===kinds.length,'Choose each required dimension once')
 const before=await all(c.db,'SELECT kind FROM pt_account_dimensions WHERE account_id=?',accountId)
 await run(c.db,[authority(c.actor,'owner'),q('DELETE FROM pt_account_dimensions WHERE account_id=?',accountId),...kinds.map(kind=>q('INSERT INTO pt_account_dimensions(account_id,kind)VALUES(?,?)',accountId,kind)),audit(who(c.actor),'dimension.required','account',accountId,{before:before.map(r=>r.kind),after:kinds})])
 return dimensionsView(c.db)
}}
export const dimensionCommands:Record<string,Command>={'dimensions.settings':settings,'dimension.save':save,'dimension.require':required}

export async function dimensionRefusal(db:D1Database,accountIds:string[],raw:Data,catalogue?:Awaited<ReturnType<typeof dimensionsView>>):Promise<string|null>{
 const d=catalogue??await dimensionsView(db),tags=dimensionTags(raw)
 for(const [kind,flag] of [['class','classes_enabled'],['location','locations_enabled'],['project','projects_enabled']] as const){
  if(!d.settings?.[flag])continue
  const value=tags[`${kind}Name`]
  if(value&&!d.values.some(v=>v.kind===kind&&v.name===value&&v.active))return `Choose an active ${kind}`
  if(!value&&d.required.some(r=>r.kind===kind&&accountIds.includes(r.account_id)))return `A required ${kind} is missing`
 }
 return null
}
const bankTags:Command={need:'record',async run(c,b){
 const id=text(b.id,'Bank line'),line=await one(c.db,'SELECT * FROM pt_bank_lines WHERE id=? AND removed_at IS NULL',id)
 requireThat(line,'Bank line not found',404)
 requireThat(!await one(c.db,'SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id=? AND active=1',id),'Undo the filing before changing bank-line dimensions',409)
 const tags=dimensionTags(b),refusal=await dimensionRefusal(c.db,[],tags)
 requireThat(!refusal,refusal??'Invalid dimensions',409)
 await run(c.db,[authority(c.actor,'record'),periodOpen(line.posted_date),guard('NOT EXISTS(SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id=? AND active=1)',id),q('UPDATE pt_bank_lines SET class_name=?,location_name=?,project_name=? WHERE id=?',...dimensionValues(tags),id),changed(),audit(who(c.actor),'bank-line.dimensions','bank-line',id,{before:dimensionTags(line),after:tags})])
 return (await one(c.db,'SELECT * FROM pt_bank_lines WHERE id=?',id))!
}}
dimensionCommands['bank-line.dimensions']=bankTags

const receiptTags:Command={need:'record',async run(c,b){
 const id=text(b.id,'Receipt'),receipt=await one(c.db,"SELECT * FROM pt_receipts WHERE id=? AND status='review'",id)
 requireThat(receipt&&receipt.revision===b.revision,'Receipt changed or is already attached; reload',409)
 const tags=dimensionTags(b),refusal=await dimensionRefusal(c.db,[],tags)
 requireThat(!refusal,refusal??'Invalid dimensions',409)
 await run(c.db,[authority(c.actor,'record'),q("UPDATE pt_receipts SET class_name=?,location_name=?,project_name=?,revision=? WHERE id=? AND revision=? AND status='review'",...dimensionValues(tags),uid(),id,b.revision),changed(),audit(who(c.actor),'receipt.dimensions','receipt',id,{before:dimensionTags(receipt),after:tags})])
 return (await one(c.db,'SELECT * FROM pt_receipts WHERE id=?',id))!
}}
dimensionCommands['receipt.dimensions']=receiptTags
