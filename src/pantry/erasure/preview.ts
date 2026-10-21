import { must } from '../access'
import type { Context } from '../context'
import { requireThat, sha256, text, type Data } from '../core'
import { all, one } from '../db'
import { openBalance } from '../invoices'
import { retentionItems } from './retention'

export async function erasurePreview(c: Context, input: Data) {
  must(c.actor,'owner')
  const kind = text(input.kind,'Subject kind'), id = text(input.id,'Subject')
  requireThat(kind === 'contact' || kind === 'member','Choose a contact or deactivated member')
  const member = kind === 'member'
  const owner = await one(c.db,"SELECT id FROM oa_operators WHERE role='owner' AND (id=? OR lower(email)=lower(?))",id,id)
  requireThat(!member || !owner,'The owner cannot be erased',409)
  const subject = await one(c.db,member ? 'SELECT * FROM pt_members WHERE email=?' : 'SELECT * FROM pt_contacts WHERE id=?',id)
  requireThat(subject,'Subject not found',404)
  requireThat(!subject.erased_at,'This subject has already been erased',409)
  requireThat(!member || !subject.active,'Deactivate this member before erasure',409)
  const auditCount = (await one(c.db,'SELECT count(*) AS n FROM pt_audit'))!.n
  const blockers: Data[] = [], classes: Data[] = []
  let posted = false
  if (!member) {
    const entries = await all(c.db,`SELECT DISTINCT e.id,e.entry_date,e.status FROM pt_journal_entries e LEFT JOIN pt_journal_lines l ON l.entry_id=e.id
      WHERE l.contact_id=? OR e.id IN (SELECT journal_id FROM pt_invoices WHERE customer_id=? UNION SELECT journal_id FROM pt_bills WHERE vendor_id=? UNION SELECT journal_id FROM pt_payments WHERE contact_id=?) ORDER BY e.id`,id,id,id,id)
    posted = entries.some(e=>e.status==='posted')
    blockers.push(...entries.filter(e=>e.status!=='posted').map(e=>({kind:'journal',id:e.id,reason:'unposted draft'})))
    for (const [table,column,date] of [['pt_invoices','customer_id','number'],['pt_bills','vendor_id','reference']] as const) {
      const rows = await all(c.db,`SELECT * FROM ${table} WHERE ${column}=?`,id)
      for (const row of rows) {
        if (['draft','approved'].includes(row.status)) blockers.push({kind:table==='pt_invoices'?'invoice':'bill',id:row.id,number:row[date],reason:'unposted draft'})
        if ((table==='pt_invoices' && row.status==='issued' && row.kind==='invoice') || (table==='pt_bills' && row.status==='posted')) {
          if (await openBalance(c.db,table==='pt_invoices'?'invoice':'bill',row.id,row.total_cents)>0) blockers.push({kind:table==='pt_invoices'?'invoice':'bill',id:row.id,number:row[date],reason:'open balance'})
        }
      }
    }
    const unapplied = await all(c.db,`SELECT p.id,p.amount_cents-COALESCE((SELECT sum(a.amount_cents) FROM pt_allocations a WHERE a.source_kind='payment' AND a.source_id=p.id),0) AS amount FROM pt_payments p WHERE p.contact_id=? AND p.reversal_id IS NULL`,id)
    blockers.push(...unapplied.filter(p=>p.amount>0).map(p=>({kind:'payment',id:p.id,reason:'unapplied open balance'})))
    const pending = await all(c.db,"SELECT p.id FROM pt_stripe_payments p JOIN pt_invoices i ON i.id=p.invoice_id WHERE i.customer_id=? AND p.status IN ('creating','open','processing','pending')",id)
    blockers.push(...pending.map(p=>({kind:'provider-payment',id:p.id,reason:'pending provider payment'})))
    for (const [table,column] of [['pt_recurring','customer_id'],['pt_recurring_bills','vendor_id']] as const) {
      blockers.push(...(await all(c.db,`SELECT id FROM ${table} WHERE ${column}=? AND status IN ('active','awaiting-approval')`,id)).map(r=>({kind:'recurring',id:r.id,reason:'active recurring template'})))
    }
    classes.push({table:'pt_contacts',action:posted?'replaced':'removed',count:1,reason:posted?'Legal name and posted bookkeeping retained':'No posted transactions'},
      {table:'pt_journal_entries',action:'retained',count:entries.filter(e=>e.status==='posted').length,reason:'Posted accounting entries, amounts, numbers, dates and coding are unchanged'})
  } else classes.push({table:'pt_members',action:'replaced',count:1,reason:'One random Former member label preserves attribution'}, {table:'oa_operators',action:'removed',reason:'Sign-in identity, sessions, links and passkeys removed'})
  const retained = member ? [] : await retentionItems(c.db,id)
  classes.push(...retained.map((item: Data)=>({...item,action:'retained'})), {table:'pt_audit',action:'replaced',reason:'Entries and bookkeeping retained; declared personal values replaced'},
    {table:'pt_approvals',action:'replaced',reason:'Approval chronology and decisions retained'})
  const fingerprint = await sha256(JSON.stringify({kind,id,subject,auditCount,blockers,retained}))
  return {kind,id,subject,posted,auditCount,classes,retained,blockers,fingerprint}
}
export function publicPreview(p: Awaited<ReturnType<typeof erasurePreview>>) {
  const { subject, auditCount, ...view } = p
  return {...view,label:subject.name}
}
