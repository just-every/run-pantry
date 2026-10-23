import assert from 'node:assert/strict'
import { books,harness } from './harness.mjs'
export const searchHarness=()=>harness({outbound:async()=>Response.json({content:[{type:'text',text:JSON.stringify({vendor:'synthetic-pantry-4 alias',date:'2026-03-02',total:45,tax:0,currency:'USD',confidence:0.95})}],stop_reason:'end_turn'})})
export async function searchScenario(h){
 const {acct}=await books(h)
 const bank=await h.command('bank-account.save',{name:'synthetic-pantry-1',institution:'synthetic-pantry-2',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'0'})
 const customer=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-3'})
 const vendor=await h.command('contact.save',{kind:'vendor',name:'synthetic-pantry-4'})
 const inv=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-03-01',dueDate:'2026-03-31',memo:'synthetic-pantry-5',lines:[{description:'design consultation',quantity:'1',rate:'1234.56',accountId:acct['4000'],taxCode:'exempt'}]})
 await h.command('invoice.approve',{id:inv.id,revision:inv.revision});await h.command('invoice.issue',{id:inv.id})
 const payment=await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-03-15',amount:'1234.56',bankAccountId:bank.id,reference:'synthetic-pantry-6',allocations:[{targetId:inv.id,amount:'1234.56'}]})
 await h.command('statement.import',{bankAccountId:bank.id,fileName:'synthetic-pantry-7.csv',content:'Date,Description,Amount\n2026-03-15,synthetic-pantry-8,1234.56\n2026-03-16,synthetic-pantry-9,987.65\n',opening:'0',closing:'2222.21',start:'2026-03-01',end:'2026-03-31',confirmLast4:'4821'})
 const bill=await h.command('bill.save',{vendorId:vendor.id,reference:'1047',billDate:'2026-03-02',dueDate:'2026-03-31',memo:'cedar wood',lines:[{description:'pine supplies',accountId:acct['6200'],amount:'45.00'}]})
 const settings=await h.command('check.settings',{bankAccountId:bank.id,nextNumber:1047,stock:'voucher',positivePay:{name:'synthetic-pantry-13',account:'synthetic-pantry-14',columns:['number','amount','date','status'].map(field=>({field,header:field})),header:true,delimiter:',',dateFormat:'YYYY-MM-DD',amountFormat:'decimal',issueCode:'I',voidCode:'V'}})
 const check=await h.command('check.issue',{bankAccountId:bank.id,revision:settings.revision,date:'2026-03-20',items:[{kind:'expense',contactId:vendor.id,amount:'25.00',accountId:acct['6200'],description:'synthetic-pantry-15',memo:'synthetic-pantry-16'}]})
 await h.command('reader.save',{provider:'anthropic',model:'synthetic-pantry-17',key:'synthetic-pantry-18'})
 const form=new FormData();form.set('file',new Blob(['synthetic-pantry-19'],{type:'application/pdf'}),'synthetic-pantry-20.pdf');form.set('source','upload')
 const captured=await fetch(h.origin+'/api/pantry/receipts/capture',{method:'POST',headers:{origin:h.origin,cookie:h.owner},body:form});assert.equal(captured.status,200);const receipt=await captured.json()
 const review=(await h.view('receipts')).review.find(r=>r.id===receipt.id)
 await h.command('receipt.vendor-confirm',{id:review.id,revision:review.revision,vendorId:vendor.id,vendorRevision:vendor.revision,confirm:true})
 return {acct,bank,customer,vendor,inv,payment,bill,check}
}
