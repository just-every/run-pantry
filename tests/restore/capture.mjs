import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { capturePhoto } from '../capture-fixtures.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export async function captureForRestore(context, origin) {
  const original = await readFile(new URL('../../fixtures/capture/synthetic-pantry-2.png', import.meta.url))
  const headers = { origin }, regions = [{x:0,y:0,width:.5,height:1},{x:.5,y:0,width:.5,height:1}]
  const created = await context.request.post(origin+'/api/pantry/receipts/captures', { headers, multipart: {
    file:{name:'synthetic-pantry-30.png',mimeType:'image/png',buffer:original},source:'camera',regions:JSON.stringify(regions),
  } })
  assert.equal(created.status(),200,await created.text());const capture=await created.json()
  const files=[{id:capture.originalDocumentId,bytes:original}],ids=[]
  for (let index=0;index<2;index++) {
    const bytes=capturePhoto(31+index)
    const result=await context.request.post(`${origin}/api/pantry/receipts/captures/${capture.id}/parts/${index}`,{headers,multipart:{captureRevision:capture.revision,file:{name:`synthetic-pantry-${31+index}.jpg`,mimeType:'image/jpeg',buffer:bytes}}})
    assert.equal(result.status(),200,await result.text());ids.push((await result.json()).id)
    const receipt=(await (await context.request.get(origin+'/api/pantry/receipts')).json()).review.find(r=>r.id===ids[index])
    files.push({id:receipt.document_id,bytes})
  }
  return {capture,files,ids}
}
export async function assertCaptureRestored(context,origin,{capture,files,ids}) {
  const receipts=(await (await context.request.get(origin+'/api/pantry/receipts')).json()).review.filter(r=>r.capture?.id===capture.id).sort((a,b)=>a.capture.index-b.capture.index)
  assert.deepEqual(receipts.map(r=>r.id),ids)
  for(const receipt of receipts) {
    assert.equal(receipt.capture.originalDocumentId,capture.originalDocumentId)
    assert.equal(receipt.capture.originalSha256,sha(files[0].bytes))
  }
  for(const file of files) {
    const response=await context.request.get(origin+'/api/pantry/documents/'+file.id)
    assert.equal(response.status(),200);assert.deepEqual(await response.body(),file.bytes)
  }
  const repeated=await context.request.post(`${origin}/api/pantry/receipts/captures/${capture.id}/parts/0`,{headers:{origin},multipart:{captureRevision:capture.revision,file:{name:'synthetic-pantry-31.jpg',mimeType:'image/jpeg',buffer:files[1].bytes}}})
  assert.equal(repeated.status(),200);assert.equal((await repeated.json()).id,ids[0],'restored provenance keeps part retries idempotent')
}
