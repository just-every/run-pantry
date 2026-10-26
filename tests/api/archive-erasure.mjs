import assert from 'node:assert/strict'
import {books,harness} from './harness.mjs'

export async function archiveErasureJourney(t) {
 const h=await harness({clock:'2036-01-15T12:00:00Z',sessionClock:'2036-01-15T12:00:00Z'});t.after(h.close)
 const {acct}=await books(h),bank=await h.command('bank-account.save',{name:'Archive checking',institution:'Synthetic bank',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'0'})
 const customer=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-601',email:'synthetic-pantry-601@example.test'})
 const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-01-02',lines:[{description:'Archive source',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt'}]})
 await h.command('invoice.approve',{id:draft.id,revision:draft.revision});const invoice=await h.command('invoice.issue',{id:draft.id})
 await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-01-03',amount:'100',bankAccountId:bank.id,allocations:[{targetId:invoice.id,amount:'100'}]})
 const batch={provider:'hubdoc',archiveKey:'synthetic-pantry-602',files:[{sourceId:'synthetic-pantry-603',name:'retained-original.txt',mediaType:'text/plain',base64:Buffer.from('synthetic-pantry-604 original').toString('base64'),sourceSystem:'xero',transactionSourceId:'synthetic-pantry-605',kind:'invoice',targetId:invoice.id}]}
 const preview=await h.command('archive.preview',batch),imported=await h.command('archive.import',{...batch,fingerprint:preview.fingerprint}),original=imported.files.find(f=>f.archive_id===imported.id)
 const before=await h.view('reports/trial-balance?to=2026-12-31'),erasure=await h.command('erasure.preview',{kind:'contact',id:customer.id})
 assert.deepEqual(erasure.blockers,[])
 await h.command('erasure.execute',{kind:'contact',id:customer.id,fingerprint:erasure.fingerprint,requester:'Synthetic privacy requester',channel:'email',reason:'Remove private contact copies',confirm:'ERASE'})
 assert.equal((await h.send('/api/pantry/documents/'+original.document_id,undefined,{cookie:h.owner})).status,200,'Source erasure keeps original financial evidence until an explicit expiry decision')
 const retained=await h.view('erasure');assert.ok(retained.items.some(i=>i.id===original.document_id))
 await h.command('retention.erase',{ids:['pt_documents:'+original.document_id],revision:retained.revision,confirm:'ERASE'})
 assert.equal((await h.send('/api/pantry/documents/'+original.document_id,undefined,{cookie:h.owner})).status,410)
 const archive=await h.view('document-archives'),erased=archive.files.find(f=>f.id===original.id)
 assert.ok(erased.erased_at);assert.equal(erased.sha256,original.sha256);assert.ok(!archive.unlinked.some(f=>f.id===erased.id))
 await h.command('archive.place',{id:erased.id,revision:erased.revision,kind:'invoice',targetId:invoice.id},undefined,409)
 await h.command('archive.preview',batch,undefined,409)
 await h.command('archive.preview',{...batch,archiveKey:'synthetic-pantry-606'},undefined,409)
 assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31'),before)
}
