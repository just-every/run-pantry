// A read-only projection. What-if items never create postings or provider work.
import type { Context } from '../context'
import { addDays, cents, date, daysBetween, requireThat, type Data } from '../core'
import { all } from '../db'
import { ageing } from '../reports'
import { occurrence, template } from '../recurring'
import { parseInvoice } from '../invoices'
import { upcomingPayroll } from '../gusto/forecast'

type Item = { id:string; date:string; amount:number; label:string; reason:string; href:string|null; kind:string }
const href=(type:string,id:string)=>'/app/search?'+new URLSearchParams({type,record:id})

/** Fully paid invoices, not credits, outstanding partial payments or reversed cash. */
async function paymentHistory(db:D1Database,asOf:string) {
 const rows=await all(db,`SELECT i.id,i.customer_id,i.issue_date,i.total_cents,a.allocation_date,p.payment_date,a.amount_cents
 FROM pt_invoices i JOIN pt_allocations a ON a.target_kind='invoice' AND a.target_id=i.id AND a.source_kind='payment'
 JOIN pt_payments p ON p.id=a.source_id WHERE i.kind='invoice' AND i.status='issued' AND i.issue_date<=?
 AND a.allocation_date<=? AND p.payment_date<=? AND (a.voided_on IS NULL OR a.voided_on>?)
 AND (p.reversal_id IS NULL OR (SELECT entry_date FROM pt_journal_entries WHERE id=p.reversal_id)>?)
 ORDER BY i.id,max(a.allocation_date,p.payment_date),a.id`,asOf,asOf,asOf,asOf,asOf)
 const invoices=new Map<string,Data>()
 for(const r of rows){const x=invoices.get(r.id)??{...r,paid:0,settled:null};x.paid+=r.amount_cents;if(x.paid>=r.total_cents&&!x.settled)x.settled=r.allocation_date>r.payment_date?r.allocation_date:r.payment_date;invoices.set(r.id,x)}
 const year=new Date(asOf+'T12:00:00Z');year.setUTCFullYear(year.getUTCFullYear()-1)
 const from=year.toISOString().slice(0,10),customers=new Map<string,Data[]>()
 for(const i of invoices.values())if(i.settled&&i.settled>=from){const group=customers.get(i.customer_id)??[];group.push({id:i.id,issued:i.issue_date,paid:i.settled,days:Math.max(0,daysBetween(i.issue_date,i.settled)),href:href('invoice',i.id)});customers.set(i.customer_id,group)}
 const history=new Map<string,{median:number|null;invoices:Data[]}>()
 for(const [customer,invoices] of customers){const latest=invoices.sort((a,b)=>b.paid.localeCompare(a.paid)||a.id.localeCompare(b.id)).slice(0,12),days=latest.map(i=>i.days).sort((a,b)=>a-b),n=days.length;history.set(customer,{median:n<3?null:n%2?days[(n-1)/2]:(days[n/2-1]+days[n/2])/2,invoices:latest})}
 return history
}

export async function cashPlanner(c:Context,query:URLSearchParams) {
 requireThat(c.actor.kind==='person','Use a native financial session',403)
 const asOf=date(query.get('asOf')??new Date().toISOString().slice(0,10),'Projection starts'),end=addDays(asOf,90)
 const threshold=cents(query.get('threshold')??'0','Low-balance threshold',{signed:true,zero:true})
 const history=await paymentHistory(c.db,asOf)
 const expected=(customer:string,issue:string,due:string)=>{const h=history.get(customer),median=h?.median;return {date:median==null?due:addDays(issue,Math.ceil(median)),reason:median==null?'Due date: fewer than three fully paid invoices in the preceding 12 months':`Issue date + median ${median} days from the latest ${h!.invoices.length} fully paid invoices (half days round later)`,history:h?.invoices??[]}}
 const banks=await all(c.db,`SELECT b.id,b.name,b.account_id,b.opening_date,b.opening_cents,
 COALESCE((SELECT SUM(l.debit_cents-l.credit_cents) FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id WHERE l.account_id=b.account_id AND e.status='posted' AND e.entry_date<=?),0) AS book_balance
 FROM pt_bank_accounts b JOIN pt_accounts a ON a.id=b.account_id WHERE a.active=1 AND a.type='asset' AND b.opening_date<=? ORDER BY b.name,b.id`,asOf,asOf)
 // A dated statement is evidence of a real bank balance; forward it using
 // bank movements after its end. Otherwise use the explicitly labelled books.
 for(const bank of banks){
  const statement=(await all(c.db,'SELECT id,end_date,closing_cents FROM pt_statements WHERE bank_account_id=? AND end_date<=? ORDER BY end_date DESC,id DESC LIMIT 1',bank.id,asOf))[0]
  const boundary=statement?.end_date??bank.opening_date
  const movement=(await all(c.db,'SELECT COALESCE(SUM(amount_cents),0) AS amount FROM pt_bank_lines WHERE bank_account_id=? AND posted_date>? AND posted_date<=? AND removed_at IS NULL',bank.id,boundary,asOf))[0].amount
  bank.balance=(statement?.closing_cents??bank.opening_cents)+movement
  bank.basis=statement?`Statement through ${boundary}, plus bank movements through ${asOf}`:`Entered opening bank balance on ${boundary}, plus bank movements through ${asOf}`
  bank.href=statement?`/app/bank?statement=${statement.id}`:`/app/search?type=journal&account=${bank.account_id}&to=${asOf}`
 }
 const items:Item[]=[],details:Data[]=[]
 const add=(item:Item)=>{if(item.date<asOf)item={...item,date:asOf,reason:item.reason+'; expected date has passed, included in current week'};if(item.date<=end)items.push(item)}
 for(const i of (await ageing(c.db,'receivable',asOf)).items as Data[]){const e=expected(i.contact_id,i.doc_date,i.due_date);add({id:i.id,date:e.date,amount:i.open,label:`Invoice ${i.ref} · ${i.contact}`,reason:e.reason,href:href('invoice',i.id),kind:'receivable'});details.push({invoiceId:i.id,...e})}
 const bills=new Map((await all(c.db,'SELECT id,scheduled_date FROM pt_bills WHERE scheduled_date IS NOT NULL')).map(b=>[b.id,b.scheduled_date]))
 for(const b of (await ageing(c.db,'payable',asOf)).items as Data[])add({id:b.id,date:bills.get(b.id)??b.due_date,amount:-b.open,label:`Bill ${b.ref} · ${b.contact}`,reason:bills.has(b.id)?'Scheduled payment date':'Bill due date',href:href('bill',b.id),kind:'payable'})
 for(const row of await all(c.db,"SELECT id FROM pt_recurring WHERE status='active' AND next_date IS NOT NULL")){
  const t=await template(c.db,row.id)
  for(let n=t.runs;n<t.runs+110;n++){
   const issue=occurrence(t.start_date,t.unit,t.every,n);if(issue>end||t.end_date&&issue>t.end_date)break
   if(await exists(c.db,'pt_recurring_runs',t.id,issue))continue
   const price=t.prices.filter((p:Data)=>p.effective_date<=issue).at(-1)
   // Projection is clearly forecast work, including draft-mode templates. It
   // never issues an invoice or treats a forecast as an approved posting.
   const parsed=await parseInvoice(c.db,{customerId:t.customer_id,issueDate:issue,dueDate:addDays(issue,t.terms_days),lines:price?.lines??t.lines,discounts:t.discounts,deposit:t.deposit,memo:t.memo})
   const e=expected(t.customer_id,issue,addDays(issue,t.terms_days))
   add({id:`recurring:${t.id}:${issue}`,date:e.date,amount:parsed.total,label:`Recurring invoice · ${t.customer_name} · ${issue}`,reason:`Forecast, not an issued invoice. ${e.reason}`,href:'/app/sales?tab=recurring',kind:'recurring-invoice'})
  }
 }
 for(const t of await all(c.db,"SELECT r.*,c.name AS vendor FROM pt_recurring_bills r JOIN pt_contacts c ON c.id=r.vendor_id WHERE r.status='active' AND r.next_date IS NOT NULL")){
  const amount=JSON.parse(t.lines).reduce((n:number,l:Data)=>n+cents(l.amount,'Recurring bill amount',{zero:true}),0)
  for(let n=t.runs;n<t.runs+110;n++){const issue=occurrence(t.start_date,t.unit,t.every,n);if(issue>end||t.end_date&&issue>t.end_date)break;if(await exists(c.db,'pt_recurring_bill_runs',t.id,issue))continue
   add({id:`recurring-bill:${t.id}:${issue}`,date:addDays(issue,t.terms_days),amount:-amount,label:`Recurring bill · ${t.vendor} · ${issue}`,reason:'Forecast draft bill plus its payment terms',href:'/app/sales?tab=bills',kind:'recurring-bill'})
  }
 }
 const payroll=await upcomingPayroll(c.env,c.db,asOf,end)
 for(const p of payroll.items)add({id:'payroll:'+p.id,date:p.date,amount:-p.amount,label:'Gusto payroll · '+p.date,reason:'Provider schedule and current calculated debit totals; not a posted payroll',href:'/app/settings?section=connected',kind:'payroll'})
 let whatIf:unknown=[]
 try{whatIf=JSON.parse(query.get('whatIf')??'[]')}catch{requireThat(false,'What-if items must be a JSON list')}
 requireThat(Array.isArray(whatIf)&&whatIf.length<=20,'Use at most 20 what-if items')
 for(const [index,value] of (whatIf as Data[]).entries()){requireThat(value&&typeof value==='object'&&typeof value.label==='string'&&value.label.trim().length>0&&value.label.length<=100,'Each what-if needs a label up to 100 characters');const day=date(value.date,'What-if date');requireThat(day>=asOf&&day<=end,'What-if date must be in the 13-week horizon');add({id:'what-if:'+index,date:day,amount:cents(value.amount,'What-if amount',{signed:true,zero:true}),label:value.label,reason:'What-if only; no ledger or provider action',href:null,kind:'what-if'})}
 let opening=banks.reduce((n,b)=>n+b.balance,0)
 const weeks=Array.from({length:13},(_,index)=>{const start=addDays(asOf,index*7),end=addDays(start,6),list=items.filter(i=>i.date>=start&&i.date<=end).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)),change=list.reduce((n,i)=>n+i.amount,0),before=opening;opening+=change;return {start,end,opening:before,change,closing:opening,low:opening<threshold,items:list}})
 return {asOf,end,threshold,opening:banks.reduce((n,b)=>n+b.balance,0),banks,weeks,expectations:details,payrollWarnings:payroll.warnings,lowWeeks:weeks.filter(w=>w.low).map(w=>w.start),method:'13 seven-day weeks anchored to the selected start date. USD cents. Each closing balance is opening plus listed items. Forecasts never post or send.'}
}
async function exists(db:D1Database,table:'pt_recurring_runs'|'pt_recurring_bill_runs',id:string,day:string){return (await all(db,`SELECT 1 FROM ${table} WHERE recurring_id=? AND occurrence=?`,id,day)).length>0}
