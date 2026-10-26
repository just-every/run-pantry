import { xeroExports } from './xero.mjs'
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import assert from 'node:assert/strict'
export async function archiveScenario(h){
 await h.command('entity.save',{legalName:'synthetic-pantry-1',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-09-01'})
 const pkg=await xeroExports(),preview=await h.command('move-in.preview',pkg);await h.command('move-in.commit',{...pkg,fingerprint:preview.fingerprint})
 const sales=await h.view('sales'),invoice=sales.invoices.find(i=>i.kind==='invoice'),bill=sales.bills[0]
 const file=(n,extra={})=>({sourceId:'synthetic-pantry-'+n,name:'synthetic-pantry-'+n+'.pdf',mediaType:'application/pdf',base64:Buffer.from('%PDF-1.4\nsynthetic-pantry-'+n+'\n%%EOF').toString('base64'),...extra})
 const batch={provider:'hubdoc',archiveKey:'synthetic-pantry-20',files:[file(21,{sourceSystem:'xero',transactionSourceId:'synthetic-pantry-30',kind:'invoice',targetId:invoice.id}),file(22)]}
 return {invoice,bill,batch,file}
}
export const hash=f=>createHash('sha256').update(Buffer.from(f.base64,'base64')).digest('hex')

// A real ZIP transport fixture, including nested paths and both ZIP methods.
// It enters the same public archive command used by the upload form.
export function archiveZipFixture(entries){
 const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=(c>>>1)^((c&1)?0xedb88320:0)}return (c^0xffffffff)>>>0},locals=[],central=[];let offset=0
 for(const [i,[path,value]] of entries.entries()){
  const name=Buffer.from(path),bytes=Buffer.from(value),method=i%2?0:8,body=method===8?deflateRawSync(bytes):bytes,local=Buffer.alloc(30),directory=Buffer.alloc(46),checksum=crc(bytes)
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(method,8);local.writeUInt32LE(checksum,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26)
  directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(method,10);directory.writeUInt32LE(checksum,16);directory.writeUInt32LE(body.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42)
  locals.push(local,name,body);central.push(directory,name);offset+=local.length+name.length+body.length
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
 return Buffer.concat([...locals,directory,end])
}

/** Fold into the existing MIGRATE-005 API flow; no new test registration. */
export async function archiveFormatsJourney(h,{invoice,bill,file}){
 const publication=await h.db.prepare("SELECT record_json FROM ik_provenance WHERE destination='books' AND target_kind='invoice' AND target_id=? AND reversed=0").bind(invoice.id).first(),source=JSON.parse(publication.record_json)
 const history=await h.db.prepare("SELECT record_json,target_id FROM ik_provenance WHERE destination='books' AND target_kind='history' AND reversed=0 LIMIT 1").first(),historical=JSON.parse(history.record_json)
 const documents=[file(101),file(102),file(103)],manifest={provider:'hubdoc',archiveKey:'synthetic-pantry-zip-1',files:[{...documents[0],base64:undefined,path:'originals/a.pdf',sourceSystem:'xero',transactionSourceId:source.sourceId,kind:'invoice'},{...documents[1],base64:undefined,path:'originals/b.pdf',sourceSystem:'xero',transactionSourceId:historical.sourceId,kind:'history'}]}
 const entries=[['export/manifest.json',JSON.stringify(manifest)],['export/originals/a.pdf',Buffer.from(documents[0].base64,'base64')],['export/originals/b.pdf',Buffer.from(documents[1].base64,'base64')],['export/'+invoice.number+'.pdf',Buffer.from(documents[2].base64,'base64')]],zip=archiveZipFixture(entries),batch={zip:{name:'vendor-export.zip',base64:zip.toString('base64')}}
 const preview=await h.command('archive.preview',batch)
 assert.deepEqual(preview.files.map(f=>f.linkedId),[invoice.id,history.target_id,null]);assert.equal(preview.files[0].mappingSource,'import-source-id')
 await h.command('archive.import',{...batch,fingerprint:'unreviewed'},undefined,409)
 const imported=await h.command('archive.import',{...batch,fingerprint:preview.fingerprint})
 assert.equal((await h.command('archive.import',{...batch,fingerprint:preview.fingerprint})).replayed,true)
 const originals=imported.files.filter(f=>f.archive_id===imported.id);assert.equal(originals.length,3)
 for(const f of originals){const response=await h.send('/api/pantry/documents/'+f.document_id,undefined,{cookie:h.owner}),expected=documents.find(d=>hash(d)===f.sha256);assert.equal(response.status,200);assert.deepEqual(Buffer.from(response.value),Buffer.from(expected.base64,'base64'))}
 const pending=imported.unlinked.find(f=>f.archive_id===imported.id);assert.ok(pending,'filename matching an invoice remains unplaced')
 const viewer=await h.member('synthetic-archive-viewer@example.test','viewer')
 await h.command('archive.preview',batch,viewer,403);await h.command('archive.import',{...batch,fingerprint:preview.fingerprint},viewer,403)
 await h.command('archive.place',{id:pending.id,revision:pending.revision,kind:'bill',targetId:bill.id},viewer,403)
 await h.command('archive.place',{id:pending.id,revision:pending.revision,kind:'bill',targetId:bill.id,sourceSystem:'freshbooks',transactionSourceId:'external-bill-source-1'})
 const csv={provider:'freshbooks',archiveKey:'synthetic-pantry-csv-1',manifest:{name:'documents.csv',content:'Document ID,File path,File name,Source system,Transaction ID,Transaction type\nexternal-doc-104,original.pdf,original.pdf,freshbooks,external-bill-source-1,bill\n'},files:[{...file(104),name:'original.pdf'}]},csvPreview=await h.command('archive.preview',csv)
 assert.equal(csvPreview.files[0].linkedId,bill.id);await h.command('archive.import',{...csv,fingerprint:csvPreview.fingerprint})
 const audit=JSON.parse((await h.db.prepare("SELECT detail FROM pt_audit WHERE action='move-in.archive' AND subject_id=?").bind(imported.id).first()).detail)
 assert.equal(audit.custody.zipSha256,createHash('sha256').update(zip).digest('hex'));assert.equal(audit.files[0].transactionSourceId,source.sourceId);assert.equal(audit.files[0].linkedId,invoice.id)
 for(const provider of ['quickbooks-online','xero','freshbooks','dext']){
  const f=file(105),metadata=provider==='quickbooks-online'?{Attachable:[{Id:'external-doc-105',FileName:f.name,ContentType:f.mediaType,SourceSystem:'xero',AttachableRef:[{EntityRef:{value:source.sourceId,type:'Invoice'}}]}]}:{Attachments:[{AttachmentID:'external-doc-105',FileName:f.name,MimeType:f.mediaType,SourceSystem:'xero',InvoiceID:source.sourceId,Type:'ACCREC'}]},request={provider,manifest:metadata,archiveKey:'synthetic-pantry-layout-'+provider,files:[f]},p=await h.command('archive.preview',request)
  assert.equal(p.files[0].linkedId,invoice.id);await h.command('archive.import',{...request,fingerprint:p.fingerprint})
 }
 const plain={provider:'dext',zip:{name:'files-only.zip',base64:archiveZipFixture([['123-invoice.pdf',Buffer.from(file(106).base64,'base64')]]).toString('base64')}},unplaced=await h.command('archive.preview',plain)
 assert.equal(unplaced.files[0].linkedId,null);assert.equal(unplaced.files[0].mappingSource,'unidentified')
 for(const bad of [archiveZipFixture([['../outside.pdf','not extracted']]),archiveZipFixture([['same.pdf','first'],['same.pdf','second']]),Buffer.from('not a ZIP')])await h.command('archive.preview',{provider:'dext',zip:{name:'bad.zip',base64:bad.toString('base64')}},undefined,400)
 const corrupt=Buffer.from(zip);corrupt[corrupt.indexOf(Buffer.from(documents[0].base64,'base64'))]^=1
 await h.command('archive.preview',{provider:'hubdoc',zip:{name:'corrupt.zip',base64:corrupt.toString('base64')}},undefined,400)
 return {imported,originals}
}
