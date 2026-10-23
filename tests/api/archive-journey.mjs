import { xeroExports } from './xero.mjs'
import { createHash } from 'node:crypto'
export async function archiveScenario(h){
 await h.command('entity.save',{legalName:'synthetic-pantry-1',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-09-01'})
 const pkg=await xeroExports(),preview=await h.command('move-in.preview',pkg);await h.command('move-in.commit',{...pkg,fingerprint:preview.fingerprint})
 const sales=await h.view('sales'),invoice=sales.invoices.find(i=>i.kind==='invoice'),bill=sales.bills[0]
 const file=(n,extra={})=>({sourceId:'synthetic-pantry-'+n,name:'synthetic-pantry-'+n+'.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.4\nsynthetic-pantry-'+n+'\n%%EOF').toString('base64'),...extra})
 const batch={provider:'hubdoc',archiveKey:'synthetic-pantry-20',files:[file(21,{sourceSystem:'xero',transactionSourceId:'synthetic-pantry-30',kind:'invoice',targetId:invoice.id}),file(22)]}
 return {invoice,bill,batch,file}
}
export const hash=f=>createHash('sha256').update(Buffer.from(f.base64,'base64')).digest('hex')
