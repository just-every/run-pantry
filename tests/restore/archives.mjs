import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export async function archivesForRestore(context,origin,invoiceId) {
 const call=async(op,data)=>{const r=await context.request.post(origin+'/api/pantry/command/'+op,{headers:{origin},data});assert.equal(r.status(),200,await r.text());return r.json()}
 const original=Buffer.from('Synthetic archive original\n\u0000Preserved exactly\n'),unplaced=Buffer.from('Synthetic unplaced archive original\n')
 const batch={provider:'hubdoc',archiveKey:'synthetic-pantry-restore-1',files:[{sourceId:'synthetic-pantry-restore-2',name:'source-invoice.txt',mediaType:'text/plain',base64:original.toString('base64'),sourceSystem:'xero',transactionSourceId:'synthetic-pantry-restore-3',kind:'invoice',targetId:invoiceId},{sourceId:'synthetic-pantry-restore-4',name:'unplaced-original.txt',mediaType:'text/plain',base64:unplaced.toString('base64')}]}
 const preview=await call('archive.preview',batch),result=await call('archive.import',{...batch,fingerprint:preview.fingerprint})
 return {id:result.id,files:result.files.filter(f=>f.archive_id===result.id).map(f=>({id:f.id,documentId:f.document_id,hash:f.sha256,linkedId:f.linked_id,bytes:f.source_id===batch.files[0].sourceId?original:unplaced}))}
}
export async function assertArchivesRestored(context,origin,expected) {
 const response=await context.request.get(origin+'/api/pantry/document-archives');assert.equal(response.status(),200)
 const v=await response.json(),archive=v.archives.find(a=>a.id===expected.id)
 assert.equal(archive.file_count,2);assert.equal(v.unlinked.filter(f=>f.archive_id===expected.id).length,1)
 for(const f of expected.files){const saved=v.files.find(d=>d.id===f.id);assert.equal(saved.sha256,f.hash);assert.equal(saved.linked_id,f.linkedId);const original=await context.request.get(origin+'/api/pantry/documents/'+f.documentId);assert.equal(original.status(),200);const bytes=await original.body();assert.deepEqual(bytes,f.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.hash)}
 const placed=expected.files.find(f=>f.linkedId)
 assert.ok(v.links.some(l=>l.target_id===placed.linkedId&&l.source_id==='synthetic-pantry-restore-3'))
}
