import { must } from '../access'
import type { Context } from '../context'
import { requireThat, sha256, text, type Data } from '../core'
import { all, one } from '../db'
import { openBalance } from '../invoices'
import { unpostedDependents } from './unposted'
import { erasureValues, MARKER } from './personal'
import { eraseCopies } from './copies'
import { immutableCopies } from './immutable-copies'
import { retentionItems } from './retention'
import { pendingErased } from '../webhooks/erasure'

export async function erasurePreview(c: Context, input: Data) {
  must(c.actor,'owner')
  const kind = text(input.kind,'Subject kind'), id = text(input.id,'Subject')
  requireThat(kind === 'contact' || kind === 'member' || kind === 'contact-person','Choose a contact or deactivated member')
  const member = kind === 'member', person = kind === 'contact-person'
  const owner = await one(c.db,"SELECT id FROM oa_operators WHERE role='owner' AND (id=? OR lower(email)=lower(?))",id,id)
  requireThat(!member || !owner,'The owner cannot be erased',409)
  const parent = await one(c.db,member ? 'SELECT * FROM pt_members WHERE email=?' : 'SELECT * FROM pt_contacts WHERE id=?',id)
  requireThat(parent,'Subject not found',404)
  requireThat(!parent.erased_at,'This subject has already been erased',409)
  requireThat(!member || !parent.active,'Deactivate this member before erasure',409)
  const personIndex=person?Number(input.personIndex):null
  const people=person?JSON.parse(parent.contacts_json??'[]'):[]
  requireThat(!person || (Number.isSafeInteger(personIndex)&&personIndex!>=0&&personIndex!<people.length),'Choose a current contact person')
  const subject=person?{...people[personIndex!],contacts_json:JSON.stringify([people[personIndex!]])}:parent
  const auditCount = (await one(c.db,'SELECT count(*) AS n FROM pt_audit'))!.n
  const blockers: Data[] = [], classes: Data[] = []
  let posted = false
  if (!member) {
    const entries = await all(c.db,`SELECT DISTINCT e.id,e.entry_date,e.status FROM pt_journal_entries e LEFT JOIN pt_journal_lines l ON l.entry_id=e.id
      WHERE l.contact_id=? OR e.id IN (SELECT journal_id FROM pt_invoices WHERE customer_id=? UNION SELECT journal_id FROM pt_bills WHERE vendor_id=? UNION SELECT journal_id FROM pt_payments WHERE contact_id=? UNION SELECT journal_id FROM pt_vendor_credits WHERE vendor_id=?) ORDER BY e.id`,id,id,id,id,id)
    posted = entries.some(e=>e.status==='posted')
    blockers.push(...entries.filter(e=>e.status!=='posted').map(e=>({kind:'journal',id:e.id,reason:'unposted draft'})))
    for (const [table,column,date] of [['pt_invoices','customer_id','number'],['pt_bills','vendor_id','reference']] as const) {
      const rows = await all(c.db,`SELECT * FROM ${table} WHERE ${column}=?`,id)
      for (const row of rows) {
        if(['issued','posted'].includes(row.status))posted=true
        if (['draft','approved'].includes(row.status)) blockers.push({kind:table==='pt_invoices'?'invoice':'bill',id:row.id,number:row[date],reason:'unposted draft'})
        if ((table==='pt_invoices' && row.status==='issued' && row.kind==='invoice') || (table==='pt_bills' && row.status==='posted')) {
          if (await openBalance(c.db,table==='pt_invoices'?'invoice':'bill',row.id,row.total_cents)>0) blockers.push({kind:table==='pt_invoices'?'invoice':'bill',id:row.id,number:row[date],reason:'open balance'})
        }
      }
    }
    const unapplied = await all(c.db,`SELECT p.id,p.amount_cents-COALESCE((SELECT sum(a.amount_cents) FROM pt_allocations a WHERE a.source_kind='payment' AND a.source_id=p.id),0) AS amount FROM pt_payments p WHERE p.contact_id=? AND p.reversal_id IS NULL`,id)
    blockers.push(...unapplied.filter(p=>p.amount>0).map(p=>({kind:'payment',id:p.id,reason:'unapplied open balance'})))
    blockers.push(...(await all(c.db,`SELECT d.id FROM pt_capture_drafts d JOIN pt_receipts r ON r.id=d.receipt_id WHERE r.vendor_id=? AND d.status IN ('draft','approved')`,id)).map(r=>({kind:'capture-draft',id:r.id,reason:'unposted draft'})))
    const credits=await all(c.db,`SELECT id FROM pt_vendor_credits v WHERE vendor_id=? AND amount_cents>COALESCE((SELECT sum(amount_cents) FROM pt_allocations a WHERE a.source_kind='credit' AND a.source_id=v.id),0) UNION SELECT id FROM pt_invoices i WHERE customer_id=? AND kind='credit' AND status='issued' AND early_reversal_id IS NULL AND total_cents>COALESCE((SELECT sum(amount_cents) FROM pt_allocations a WHERE a.source_kind='credit' AND a.source_id=i.id AND a.voided_on IS NULL),0)`,id,id)
    blockers.push(...credits.map(r=>({kind:'credit',id:r.id,reason:'unapplied open balance'})))
    blockers.push(...(await all(c.db,`SELECT DISTINCT r.id FROM pt_recurring_journals r,json_each(r.lines) l WHERE r.status IN ('active','awaiting-approval') AND (json_extract(l.value,'$.contactId')=? OR json_extract(l.value,'$.contact_id')=?)`,id,id)).map(r=>({kind:'recurring-journal',id:r.id,reason:'active recurring template'})))
    const pending = await all(c.db,"SELECT p.id FROM pt_stripe_payments p JOIN pt_invoices i ON i.id=p.invoice_id WHERE i.customer_id=? AND p.status IN ('creating','open','processing','pending')",id)
    blockers.push(...pending.map(p=>({kind:'provider-payment',id:p.id,reason:'pending provider payment'})))
    for (const [table,column] of [['pt_recurring','customer_id'],['pt_recurring_bills','vendor_id']] as const) {
      blockers.push(...(await all(c.db,`SELECT id FROM ${table} WHERE ${column}=? AND status IN ('active','awaiting-approval')`,id)).map(r=>({kind:'recurring',id:r.id,reason:'active recurring template'})))
    }
    classes.push({table:'pt_contacts',action:posted?'replaced':'removed',count:1,reason:posted?'Legal name and posted bookkeeping retained':'No posted transactions'},
      {table:'pt_journal_entries',action:'retained',count:entries.filter(e=>e.status==='posted').length,reason:'Posted accounting entries, amounts, numbers, dates and coding are unchanged'})
  } else classes.push({table:'pt_members',action:'replaced',count:1,reason:'One random Former member label preserves attribution'}, {table:'oa_operators',action:'removed',reason:'Sign-in identity, sessions, links and passkeys removed'})
  const retained = member ? [] : await retentionItems(c.db,id)
  if(person) {classes.splice(0,1,{table:'pt_contacts.contacts_json',action:'removed',count:1,reason:'Only this contact person is removed; the business and other contacts remain'})}
  classes.push(...retained.map((item: Data)=>({...item,action:'retained'})), {table:'pt_audit',action:'replaced',reason:'Entries and bookkeeping retained; declared personal values replaced'},
    {table:'pt_approvals',action:'replaced',reason:'Approval chronology and decisions retained'})
  const values=person?[subject.name,subject.email,subject.phone].filter(Boolean):await erasureValues(c.db,subject,member,posted)
  const copies=await eraseCopies(c.db,{id,member:member||person,posted,values,marker:MARKER,erasureId:'preview',at:new Date().toISOString()})
  const pendingWebhooks=await pendingErased(c.db,id,copies.affectedRecordIds)
  if(pendingWebhooks)classes.push({table:'pt_webhook_deliveries',action:'replaced',count:pendingWebhooks,reason:`${pendingWebhooks} pending webhook notices cancelled as record_erased; body-free history retained`})
  const immutable=await immutableCopies(c.db,{values,marker:MARKER,member,erasureId:'preview'})
  if(!member&&!person&&!posted)for(const [table,counts] of Object.entries((await unpostedDependents(c.db,id)).counts))classes.push({table,action:'removed',reason:'Dormant records without posted transactions',counts})
  const listed=new Set(classes.map(r=>r.table))
  for(const [table,counts] of Object.entries({...copies.counts,...immutable.counts}))if(!listed.has(table)&&Object.values(counts).some(v=>Number(v)>0))classes.push({table,action:'replaced',reason:'Declared personal copies removed; accounting fields retained',counts})
  const fingerprint = await sha256(JSON.stringify({kind,id,personIndex,parent,subject,auditCount,blockers,retained,classes}))
  return {kind,id,personIndex,parent,subject,posted,auditCount,classes,retained,blockers,fingerprint}
}
export function publicPreview(p: Awaited<ReturnType<typeof erasurePreview>>) {
  const { subject, parent, auditCount, ...view } = p
  return {...view,label:subject.name}
}
