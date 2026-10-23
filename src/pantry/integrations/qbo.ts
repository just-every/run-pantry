import { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { cents, quantity, scale, Fault, requireThat, type Data } from '../core'
import { identify } from './credentials'
import { integrations } from './routes'
import { one } from '../db'

/** Compatibility translation only: native scoped doors own every read and write. */
export const qbo = new Hono<{Bindings:Bindings}>()
const fault=(message:string,status=400)=>({Fault:{Error:[{Message:message,Detail:message,code:status===401?'3200':'6000'}],type:status===401?'AuthenticationFault':'ValidationFault'},time:new Date().toISOString()})
qbo.onError((e,c)=>{const status=e instanceof Fault?e.status:500;return c.json(fault(e instanceof Fault?e.message:'Unexpected compatibility error',status),status as 400)})
qbo.use('*',async(c,next)=>{c.header('cache-control','no-store');const credential=await identify(c.req.raw,c.env);requireThat(credential&&!credential.revoked,'A current Pantry integration token is required',401);requireThat(/^\/qbo\/v3\/company\/pantry(?:\/|$)/.test(new URL(c.req.url).pathname),'The documented realmId is pantry',404);await next();c.header('cache-control','no-store')})
const routes:Record<string,{path:string;key:string}>= {customer:{path:'contacts',key:'contacts'},vendor:{path:'contacts',key:'contacts'},invoice:{path:'invoices',key:'invoices'},payment:{path:'payments',key:'payments'},account:{path:'accounts',key:'accounts'},item:{path:'items',key:'items'},bill:{path:'bills',key:'bills'},journalentry:{path:'journals',key:'entries'},attachable:{path:'documents',key:'documents'}}
const names:Record<string,string>={customer:'Customer',vendor:'Vendor',invoice:'Invoice',payment:'Payment',account:'Account',item:'Item',bill:'Bill',journalentry:'JournalEntry',attachable:'Attachable'}
const amount=(n:unknown)=>Number(n??0)/100
function project(kind:string,r:Data):Data {
  const base={Id:r.id,SyncToken:r.revision??'0',domain:'QBO',sparse:false}
  if(kind==='customer'||kind==='vendor')return {...base,DisplayName:r.name,CompanyName:r.name,Active:!!r.active,PrimaryEmailAddr:{Address:r.email}}
  if(kind==='invoice')return {...base,DocNumber:r.number,TxnDate:r.issue_date,DueDate:r.due_date,CustomerRef:{value:r.customer_id,name:r.customer_name},TotalAmt:amount(r.total_cents),Balance:amount(r.open_cents),PrivateNote:r.memo,Line:(r.lines??[]).map((l:Data)=>({Id:l.id,LineNum:l.line_no,Description:l.description,Amount:amount(l.amount_cents),DetailType:'SalesItemLineDetail',SalesItemLineDetail:{ItemRef:{value:l.item_id??l.account_id},Qty:l.quantity_milli/1000,UnitPrice:amount(l.unit_cents),TaxCodeRef:{value:l.tax_code==='exempt'?'NON':l.tax_code}}})),TxnTaxDetail:{TotalTax:amount(r.tax_cents)}}
  if(kind==='payment')return {...base,TxnDate:r.payment_date,CustomerRef:{value:r.contact_id},TotalAmt:amount(r.amount_cents),UnappliedAmt:amount(r.unallocated_cents),PaymentRefNum:r.reference,Line:(r.allocations??[]).map((a:Data)=>({Amount:amount(a.amount_cents),LinkedTxn:[{TxnId:a.target_id,TxnType:'Invoice'}]}))}
  if(kind==='account')return {...base,Name:r.name,AcctNum:r.code,Active:!!r.active,AccountType:({asset:'Other Current Asset',liability:'Other Current Liability',equity:'Equity',income:'Income',expense:'Expense'} as Record<string,string>)[r.type]}
  if(kind==='item')return {...base,Name:r.name,Active:!!r.active,Type:'Service',UnitPrice:amount(r.rate_cents),IncomeAccountRef:{value:r.income_account_id}}
  if(kind==='attachable')return {...base,FileName:r.name,ContentType:r.media_type,Size:r.size,TempDownloadUri:'/api/pantry/integration/v1/documents/'+r.id,AttachableRef:r.linked_id?[{EntityRef:{type:r.linked_kind==='invoice'?'Invoice':'Bill',value:r.linked_id}}]:[]}
  return {...base,...(kind==='bill'?{DocNumber:r.reference,TxnDate:r.bill_date,VendorRef:{value:r.vendor_id},TotalAmt:amount(r.total_cents),Balance:amount(r.open_cents)}:{TxnDate:r.entry_date,PrivateNote:r.memo}),Line:(r.lines??[]).map((l:Data)=>({Id:l.id,Amount:amount(l.amount_cents??Math.max(l.debit_cents,l.credit_cents)),Description:l.description??l.memo}))}
}
async function native(c:any,path:string,body?:Data) {
  const headers=new Headers(c.req.raw.headers);headers.delete('content-length');headers.set('content-type','application/json')
  const key=c.req.query('requestid')??c.req.query('requestId')??headers.get('idempotency-key')??headers.get('intuit-request-id')
  if(key)headers.set('idempotency-key',key)
  const request=new Request(new URL('/'+path,c.req.url),{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})})
  const response=await integrations.fetch(request,c.env,c.executionCtx)
  for(const key of ['X-RateLimit-Limit','X-RateLimit-Remaining','X-RateLimit-Reset','Retry-After'])if(response.headers.has(key))c.header(key,response.headers.get(key)!)
  const value=await response.json() as Data
  requireThat(response.ok,value.error??'Native scoped request refused',response.status)
  return value
}
async function list(c:any,kind:string,params=new URLSearchParams()) {
  const spec=routes[kind];requireThat(spec,'Unsupported QuickBooks entity: '+kind,400)
  if(kind==='customer'||kind==='vendor')params.set('kind',kind)
  if(kind==='account')return (await native(c,'accounts?'+params)).records
  const data=await native(c,spec.path+'?'+params)
  return data[spec.key]??data.records
}
qbo.get('/:realmId/query',async c=>{
  const query=c.req.query('query')??''
  const parsed=/^select\s+\*\s+from\s+(\w+)(?:\s+where\s+(Id|DisplayName|DocNumber|CustomerRef)\s*=\s*'([^']*)')?(?:\s+startposition\s+(\d+))?(?:\s+maxresults\s+(\d+))?\s*$/i.exec(query)
  requireThat(parsed,'Unsupported query: use SELECT * FROM a documented entity, an optional exact filter, STARTPOSITION and MAXRESULTS')
  const kind=parsed[1].toLowerCase(),start=Number(parsed[4]??1),limit=Number(parsed[5]??100)
  requireThat(start===1&&limit>=1&&limit<=100,'This subset supports STARTPOSITION 1 and MAXRESULTS 1–100')
  const params=new URLSearchParams({limit:String(limit)})
  if(parsed[2]){const field=parsed[2].toLowerCase();const filter=field==='id'?'id':field==='displayname'&&['customer','vendor'].includes(kind)?'name':field==='docnumber'&&kind==='invoice'?'number':field==='customerref'&&kind==='invoice'?'customerId':null;requireThat(filter,'Exact filter is unsupported for this entity');params.set(filter,parsed[3])}
  const rows=await list(c,kind,params)
  return c.json({QueryResponse:{[names[kind]]:rows.slice(0,limit).map((r:Data)=>project(kind,r)),startPosition:1,maxResults:rows.length},time:new Date().toISOString()})
})
qbo.post('/:realmId/upload',async c=>{
  const bytes=await c.req.arrayBuffer();requireThat(bytes.byteLength<=8_000_000,'Attachment request is limited to 8 MB',413)
  const form=await new Request(c.req.url,{method:'POST',headers:c.req.raw.headers,body:bytes}).formData()
  const metadata=form.get('file_metadata_01'),file=form.get('file_content_01')
  requireThat(typeof metadata==='string'&&file instanceof File,'Send file_metadata_01 and file_content_01 multipart fields')
  const info=JSON.parse(metadata) as Data,ref=info.AttachableRef?.[0]?.EntityRef
  requireThat(!ref||ref.type==='Invoice'||ref.type==='Bill','Only Invoice and Bill attachment links are supported')
  const content=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<content.length;i+=8192)binary+=String.fromCharCode(...content.subarray(i,i+8192))
  const result=await native(c,'documents',{name:info.FileName??file.name,mediaType:info.ContentType??file.type,base64:btoa(binary),...(ref?{linkedKind:ref.type.toLowerCase(),linkedId:ref.value}:{})})
  return c.json({AttachableResponse:[{Attachable:project('attachable',result)}],time:new Date().toISOString()})
})
qbo.get('/:realmId/:entity/:id',async c=>{
  const kind=c.req.param('entity').toLowerCase(),spec=routes[kind];requireThat(spec,'Unsupported QuickBooks entity: '+kind)
  const id=c.req.param('id')
  const record=kind==='attachable'?(await native(c,'documents?id='+encodeURIComponent(id))).documents[0]:await native(c,spec.path+'/'+encodeURIComponent(id))
  requireThat(record,'Record not found',404);if(kind==='customer'||kind==='vendor')requireThat(record.kind===kind,'Record not found',404)
  return c.json({[names[kind]]:project(kind,record),time:new Date().toISOString()})
})
qbo.post('/:realmId/:entity',async c=>{
  requireThat(!c.req.query('operation'),'Unsupported QuickBooks operation: '+c.req.query('operation'))
  const raw=await c.req.text();requireThat(raw.length<=8_000_000,'Request is limited to 8 MB',413)
  let b:Data;try{b=JSON.parse(raw)}catch{throw new Fault(400,'Send a JSON object')}
  requireThat(b&&typeof b==='object'&&!Array.isArray(b),'Send a JSON object')
  requireThat(!b.Id&&!b.sparse,'Updating records is not supported by this subset')
  requireThat(!b.CurrencyRef||b.CurrencyRef.value==='USD','Only USD is supported')
  const kind=c.req.param('entity').toLowerCase();let body:Data,path:string
  const fields:Record<string,string[]>= {customer:['DisplayName','CompanyName','PrimaryEmailAddr','Active'],vendor:['DisplayName','CompanyName','PrimaryEmailAddr','Active'],invoice:['CustomerRef','TxnDate','DueDate','DocNumber','Line','PrivateNote','TotalAmt','TxnTaxDetail'],payment:['CustomerRef','DepositToAccountRef','TxnDate','TotalAmt','PaymentRefNum','Line']}
  requireThat(fields[kind],'Unsupported QuickBooks entity or write operation: '+kind)
  requireThat(Object.keys(b).every(k=>fields[kind].includes(k)||['domain','sparse','CurrencyRef'].includes(k)),'Unsupported field for this QuickBooks operation')
  if(kind==='customer'||kind==='vendor') {requireThat(b.Active!==false,'Deactivating contacts is unsupported');requireThat(!b.CompanyName||!b.DisplayName||b.CompanyName===b.DisplayName,'Separate CompanyName and DisplayName values are unsupported');path='contacts';body={kind,externalId:c.req.query('requestid')??c.req.header('idempotency-key')??b.DisplayName,name:b.DisplayName??b.CompanyName,email:b.PrimaryEmailAddr?.Address}}
  else if(kind==='invoice') {
    requireThat(Array.isArray(b.Line)&&b.Line.length>0,'Invoice requires SalesItemLineDetail lines')
    requireThat(!b.TxnTaxDetail?.TotalTax,'Only tax-exempt invoices are supported')
    if(b.TotalAmt!==undefined)requireThat(cents(String(b.TotalAmt),'Total')===b.Line.reduce((s:number,l:Data)=>s+cents(String(l.Amount),'Line amount'),0),'TotalAmt must equal line amounts')
    const credential=await identify(c.req.raw,c.env)
    path='invoices';body={customerId:b.CustomerRef?.value,number:b.DocNumber,issueDate:b.TxnDate??new Date().toISOString().slice(0,10),dueDate:b.DueDate,memo:b.PrivateNote,post:credential!.scopes.includes('post'),lines:b.Line.map((l:Data)=>{requireThat(l.DetailType==='SalesItemLineDetail','Only SalesItemLineDetail invoice lines are supported');const d=l.SalesItemLineDetail;requireThat(d?.ItemRef?.value,'Invoice lines need an existing native item');const qty=quantity(String(d.Qty??1),'Quantity'),unit=cents(String(d.UnitPrice??l.Amount),'Unit price',{zero:true});requireThat(l.Amount===undefined||cents(String(l.Amount),'Line amount')===scale(qty,unit,1000),'Line Amount must equal Qty multiplied by UnitPrice');requireThat(d?.TaxCodeRef?.value==='NON','Set TaxCodeRef to NON for this tax-exempt subset');return {description:l.Description,itemId:d.ItemRef?.value,quantity:String(d.Qty??1),rate:String(d.UnitPrice??l.Amount),taxCode:'exempt'}})}
  } else if(kind==='payment') {
    requireThat(Array.isArray(b.Line)&&b.Line.every((l:Data)=>Array.isArray(l.LinkedTxn)&&l.LinkedTxn.length===1&&l.LinkedTxn[0].TxnType==='Invoice'),'Payments require one Invoice link per line')
    path='payments';body={direction:'received',contactId:b.CustomerRef?.value,date:b.TxnDate??new Date().toISOString().slice(0,10),amount:String(b.TotalAmt),bankAccountId:(await one(c.env.DB,'SELECT id FROM pt_bank_accounts WHERE id=? OR account_id=? ORDER BY id LIMIT 1',b.DepositToAccountRef?.value??'',b.DepositToAccountRef?.value??''))?.id??b.DepositToAccountRef?.value,reference:b.PaymentRefNum,allocations:b.Line.map((l:Data)=>({targetId:l.LinkedTxn[0].TxnId,amount:String(l.Amount)}))}
  } else throw new Fault(400,'Unsupported QuickBooks entity or write operation: '+c.req.param('entity'))
  const result=await native(c,path,body)
  return c.json({[names[kind]]:project(kind,result),time:new Date().toISOString()})
})
qbo.all('*',c=>c.json(fault('Unsupported QuickBooks entity or operation'),400))
