import { authority, who } from '../access'
import type { Command, Context } from '../context'
import { now, requireThat, text, uid, type Data } from '../core'
import { audit, changed, guard, one, q, run } from '../db'
import { businessDay, sendingSettings } from '../delivery'
import { assertOwner, recipient, recipientGuard } from './store'
import type { Schedule, Selection } from './types'
function email(value: unknown) {
  const address=text(value,'Email address',254).toLowerCase()
  requireThat(/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address),'Enter one email address')
  return address
}
function selection(value: Data): Selection {
  requireThat(value && ['report','custom-report','management-package','accountant-package'].includes(value.kind),'Select a report or package')
  const kind=value.kind as Selection['kind'], result: Selection={kind}
  if (kind==='report') result.report=text(value.report,'Report',100)
  if (kind==='custom-report'||kind==='management-package') result.id=text(value.id,'Saved report or package',100)
  requireThat(value.rangeMode===undefined||['saved','occurrence'].includes(value.rangeMode),'Choose saved dates or occurrence dates')
  result.rangeMode=value.rangeMode??(['custom-report','management-package'].includes(kind)?'saved':'occurrence')
  requireThat(!value.query||(typeof value.query==='object'&&!Array.isArray(value.query)),'Invalid report filters')
  result.query={}
  for(const [key,v] of Object.entries(value.query??{})) {
    requireThat(/^[A-Za-z][A-Za-z0-9]*$/.test(key)&&typeof v==='string'&&v.length<=300,'Invalid report filter')
    result.query[key]=v as string
  }
  return result
}
async function save(c:Context,b:Data) {
  await assertOwner(c)
  const existing=b.id?await one<Schedule>(c.db,'SELECT * FROM pt_report_schedules WHERE id=?',text(b.id,'Schedule',100)):null
  requireThat(!b.id||existing,'Schedule not found',404)
  requireThat(!existing||existing.revision===b.revision,'Schedule changed; reload',409)
  const active=b.active===true, consent=b.consent===true
  requireThat(!active||consent,'Explicit consent to email the selected report to these recipients is required')
  const selected=selection(b.selection), format=text(b.format,'Format',10), cadence=text(b.cadence,'Frequency',20)
  requireThat(['pdf','xlsx','csv'].includes(format),'Choose PDF, Excel or CSV')
  requireThat(['weekly','monthly','month-lock'].includes(cadence),'Choose weekly, monthly or when a month locks')
  const weekday=Number(b.weekday??1), monthDay=Number(b.monthDay??1)
  requireThat(Number.isInteger(weekday)&&weekday>=0&&weekday<=6&&Number.isInteger(monthDay)&&monthDay>=1&&monthDay<=28,'Invalid calendar schedule')
  requireThat(Array.isArray(b.recipients)&&b.recipients.length>0&&b.recipients.length<=20,'Choose 1 to 20 recipients')
  const addresses=[...new Set<string>(b.recipients.map(email))], recipients=await Promise.all(addresses.map(a=>recipient(c.db,a)))
  requireThat(recipients.every(Boolean),'An outside address must first be explicitly allowlisted by the owner')
  const operator=await one(c.db,"SELECT id,lower(email) AS email,version FROM oa_operators WHERE id=? AND status='active' AND role='owner'",c.actor.id)
  requireThat(operator,'Active owner required',403)
  const settings=await sendingSettings(c.db), at=now()
  const id=existing?.id??uid(),revision=uid(),name=text(b.name,'Schedule name',200)
  await run(c.db,[authority(c.actor,'owner'),guard('EXISTS(SELECT 1 FROM pt_sending WHERE id=1 AND revision=?)',settings.revision),guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND lower(email)=? AND status='active' AND role='owner')",operator.id,operator.version,operator.email),...recipients.map(r=>recipientGuard(r!.email,r!.scope)),
    ...(existing?[guard('EXISTS(SELECT 1 FROM pt_report_schedules WHERE id=? AND revision=?)',id,b.revision)]:[]),
    q(`INSERT INTO pt_report_schedules(id,revision,name,selection,format,cadence,weekday,month_day,recipients,active,consent,creator_id,creator_email,creator_version,activated_at,activated_day,lock_watermark,time_zone)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(rowid),0) FROM pt_audit),?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,name=excluded.name,selection=excluded.selection,format=excluded.format,cadence=excluded.cadence,weekday=excluded.weekday,month_day=excluded.month_day,recipients=excluded.recipients,active=excluded.active,consent=excluded.consent,creator_id=excluded.creator_id,creator_email=excluded.creator_email,creator_version=excluded.creator_version,activated_at=excluded.activated_at,activated_day=excluded.activated_day,lock_watermark=excluded.lock_watermark,time_zone=excluded.time_zone`,
      id,revision,name,JSON.stringify(selected),format,cadence,weekday,monthDay,JSON.stringify(addresses),+active,+consent,operator.id,operator.email,operator.version,at,businessDay(settings.time_zone),settings.time_zone),
    q("UPDATE pt_report_deliveries SET status='cancelled',detail='Schedule revision changed before sending',finished_at=? WHERE schedule_id=? AND status='claimed'",at,id),
    audit(who(c.actor),'report-schedule.save','report-schedule',id,{revision,name,selection:selected,format,cadence,recipients:addresses,active,consent})])
  return {id,revision}
}
export const reportDeliveryCommands:Record<string,Command>={
 'report-schedule.save':{need:'owner',run:save},
 'report-schedule.disable':{need:'owner',run:async(c,b)=>{
   await assertOwner(c);const revision=uid(),id=text(b.id,'Schedule',100)
   await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_report_schedules SET active=0,consent=0,revision=? WHERE id=? AND revision=?',revision,id,text(b.revision,'Revision',100)),changed(),q("UPDATE pt_report_deliveries SET status='cancelled',detail='Schedule disabled before sending',finished_at=? WHERE schedule_id=? AND status='claimed'",now(),id),audit(who(c.actor),'report-schedule.disable','report-schedule',id,{revision})]);return{id,revision}
 }},
 'report-recipient.allow':{need:'owner',run:async(c,b)=>{
   await assertOwner(c);const address=email(b.email),note=text(b.note,'Reason for outside access',500),revision=uid(),old=await one(c.db,'SELECT revision FROM pt_report_allowlist WHERE email=?',address),active=b.active===true
   requireThat(!old||b.revision===old.revision,'Allowlist changed; reload',409)
   await run(c.db,[authority(c.actor,'owner'),...(old?[guard('EXISTS(SELECT 1 FROM pt_report_allowlist WHERE email=? AND revision=?)',address,b.revision)]:[guard('NOT EXISTS(SELECT 1 FROM pt_report_allowlist WHERE email=?)',address)]),q('INSERT INTO pt_report_allowlist(email,active,note,revision,approved_by,approved_at) VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET active=excluded.active,note=excluded.note,revision=excluded.revision,approved_by=excluded.approved_by,approved_at=excluded.approved_at',address,+active,note,revision,c.actor.email,now()),audit(who(c.actor),'report-recipient.allow','report-recipient',address,{active,note,revision})]);return{email:address,revision,active}
 }}
}
