import type { Command, Context } from './context'
import { authority, who } from './access'
import { all, approval, audit, changed, guard, one, q, run } from './db'
import { now, requireThat, text, uid, type Data } from './core'
import { sendingView, sendReviewedTaxMail } from './delivery'
import { w9Commands } from './w9'
import { BATCH_CAP, DAILY_CAP, calendar, itemGuards, taxItems, vendorItems } from './tax-reminder-content'
function owner(c: Context) { requireThat(c.actor.kind==='person' && c.actor.role==='owner','Only the owner manages tax reminder batches',403) }
const enabled = (c:Context) => guard('EXISTS(SELECT 1 FROM pt_tax_reminder_preferences WHERE id=1 AND enabled=1 AND owner_id=? AND owner_email=?)',c.actor.id,c.actor.email)
async function batch(c:Context,id:string): Promise<Data> {
  const row = await one(c.db,'SELECT * FROM pt_tax_reminder_batches WHERE id=?',id)
  requireThat(row,'Batch not found',404)
  return {...row,items:JSON.parse(row.items),outcomes:JSON.parse(row.outcomes)}
}
export async function taxRemindersView(c:Context,year:number) {
  owner(c)
  return {deadlines:await taxItems(c,year),vendors:await all(c.db,'SELECT c.id,c.name,c.email,EXISTS(SELECT 1 FROM pt_tax_vendor_stops s WHERE s.contact_id=c.id) AS optedOut FROM pt_contacts c WHERE c.kind=\'vendor\' AND c.active=1 AND c.erased_at IS NULL ORDER BY c.name'),
    batches:await Promise.all((await all(c.db,'SELECT id FROM pt_tax_reminder_batches ORDER BY created_at DESC,rowid DESC LIMIT 30')).map(r=>batch(c,r.id))),
    enabled:!!(await one(c.db,'SELECT enabled FROM pt_tax_reminder_preferences WHERE id=1 AND owner_id=? AND owner_email=?',c.actor.id,c.actor.email))?.enabled,mail:(await sendingView(c.env,c.db)).mail,batchCap:BATCH_CAP,dailyCap:DAILY_CAP}
}
const preference:Command={need:'owner',async run(c,b){owner(c);requireThat(typeof b.enabled==='boolean','Choose reminder consent');await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_tax_reminder_preferences SET enabled=?,owner_id=?,owner_email=? WHERE id=1',b.enabled?1:0,c.actor.id,c.actor.email),audit(who(c.actor),'tax-reminders.consent','tax-reminders','1',{enabled:b.enabled})]);return {enabled:b.enabled}}}
const stop:Command={need:'owner',async run(c,b){owner(c);const id=text(b.contactId,'Vendor');await run(c.db,[authority(c.actor,'owner'),q('INSERT OR IGNORE INTO pt_tax_vendor_stops(contact_id,at) VALUES(?,?)',id,now()),audit(who(c.actor),'tax-reminders.vendor-opt-out','vendor',id)]);return {optedOut:true}}}
const prepare:Command={need:'owner',async run(c,b){owner(c);requireThat(['w9-request','w9-reminder','tax'].includes(b.kind),'Choose a reminder type');let items:Data[]
  if(b.kind==='tax') {
    requireThat(Array.isArray(b.deadlineIds) && b.deadlineIds.length>0 && b.deadlineIds.length<=BATCH_CAP && new Set(b.deadlineIds).size===b.deadlineIds.length,'Select one to ten distinct recorded deadlines')
    items=(await taxItems(c,Number(b.year))).filter(i=>b.deadlineIds.includes(i.deadlineId))
    requireThat(items.length===b.deadlineIds.length,'A selected deadline changed or completed; reload',409)
  } else items=await vendorItems(c,b.contactIds,b.kind==='w9-reminder');requireThat(items.length>0 && items.length<=BATCH_CAP,'Select at most ten active recorded deadlines or vendors');const id=uid();await run(c.db,[authority(c.actor,'owner'),...(b.kind==='tax'?[enabled(c)]:[]),...itemGuards(items),q('INSERT INTO pt_tax_reminder_batches(id,kind,items,created_at) VALUES(?,?,?,?)',id,b.kind,JSON.stringify(items),now()),audit(who(c.actor),'tax-reminders.prepare','tax-reminder-batch',id,{kind:b.kind,items})]);return batch(c,id)}}
const send:Command={need:'owner',async run(c,b){owner(c);requireThat(b.consent===true,'Approve this exact recipient list and wording');const row=await batch(c,text(b.id,'Batch'));requireThat(row.status==='draft','This batch was already claimed; prepare a new batch for any further send',409);const items:Data[]=row.items,day=now().slice(0,10);
  await run(c.db,[authority(c.actor,'owner'),...(row.kind==='tax'?[enabled(c)]:[]),...itemGuards(items),
    guard('(SELECT COALESCE(SUM(json_array_length(items)),0) FROM pt_tax_reminder_batches WHERE claimed_day=?) + ? <= ?',day,items.length,DAILY_CAP),
    q("UPDATE pt_tax_reminder_batches SET status='sending',approved_by=?,approved_at=?,claimed_day=? WHERE id=? AND status='draft'",c.actor.email,now(),day,row.id),changed(),
    approval(who(c.actor),'tax-reminder-batch',row.id,row.id,'send','approved'),audit(who(c.actor),'tax-reminders.approve','tax-reminder-batch',row.id,{consent:true,items})])
  const claimed=()=>guard("EXISTS(SELECT 1 FROM pt_tax_reminder_batches WHERE id=? AND status='sending')",row.id)
  const outcomes:Data[]=[]
  for (const item of items) {
    // Recheck current consent and source at every network boundary. Never retry a claimed batch.
    try {
      requireThat(now().slice(0,10)===day,'The batch day changed; prepare a fresh batch',409)
      await run(c.db,[authority(c.actor,'owner'),claimed(),...(row.kind==='tax'?[enabled(c)]:[]),...itemGuards([item])])
      let body=item.body
      if(item.contactId){const link=await w9Commands['w9.request'].run(c,{contactId:item.contactId,contactRevision:item.contactRevision,consent:true});body+=`\n\n${link.url}`}
      await run(c.db,[authority(c.actor,'owner'),claimed(),...(row.kind==='tax'?[enabled(c)]:[]),...itemGuards([item])])
      requireThat(now().slice(0,10)===day,'The batch day changed; prepare a fresh batch',409)
      const result=await sendReviewedTaxMail(c.env,item.to,item.subject,body,`${row.id}-${outcomes.length}`)
      outcomes.push({to:item.to,...result})
    } catch {
      if((await batch(c,row.id)).status!=='sending')break
      outcomes.push({to:item.to,status:'uncertain',detail:'The current source check or mail route did not confirm delivery; no automatic retry.'})
    }
    try {
      await run(c.db,[claimed(),q('UPDATE pt_tax_reminder_batches SET outcomes=? WHERE id=?',JSON.stringify(outcomes),row.id),audit(who(c.actor),'tax-reminders.outcome','tax-reminder-batch',row.id,{outcome:outcomes.at(-1)})])
    } catch(error) {
      if((await batch(c,row.id)).status==='cancelled')return batch(c,row.id)
      throw error
    }
  }
  await run(c.db,[q("UPDATE pt_tax_reminder_batches SET status='finished' WHERE id=? AND status='sending'",row.id)])
  return batch(c,row.id)
}}
const download:Command={need:'owner',async run(c,b){owner(c);requireThat(b.consent===true,'Confirm calendar export');const year=Number(b.year),items=await taxItems(c,year);await run(c.db,[authority(c.actor,'owner'),enabled(c),...itemGuards(items),audit(who(c.actor),'tax-reminders.calendar','tax-reminders','1',{consent:true,deadlineIds:items.map(i=>i.deadlineId)})]);return {filename:`tax-reminders-${year}.ics`,calendar:calendar(items,now())}}}
export const taxReminderCommands:Record<string,Command>={'tax-reminders.preference':preference,'tax-reminders.vendor-stop':stop,'tax-reminders.prepare':prepare,'tax-reminders.send':send,'tax-reminders.calendar':download}
