import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { harness } from './harness.mjs'

function storedFiles(bytes) {
  const files = new Map()
  for (let at=0;bytes.readUInt32LE(at)===0x04034b50;) {
    const method=bytes.readUInt16LE(at+8);assert.ok(method===0||method===8,'ZIP entry uses a supported transport method')
    const size=bytes.readUInt32LE(at+18),nameLength=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+nameLength+extra
    const payload=bytes.subarray(start,start+size);files.set(bytes.subarray(at+30,at+30+nameLength).toString('utf8'),method===8?inflateRawSync(payload):payload);at=start+size
  }
  return files
}

/** Shared API and browser fixture: all records and the close use actual public commands. */
export async function destinationBooks(command,view) {
  const h={command,view}
  await h.command('entity.save',{legalName:'Synthetic destination business',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'accrual',booksStart:'2026-12-01'})
  await h.command('chart.start',{})
  const accounts=(await h.view('state')).accounts,account=code=>accounts.find(a=>a.code===code).id
  const customer=await h.command('contact.save',{kind:'customer',name:'=Synthetic spreadsheet formula',email:'synthetic-destination@example.test'})
  const vendor=await h.command('contact.save',{kind:'vendor',name:'Synthetic destination vendor'})
  const item=await h.command('item.save',{name:'Synthetic exact-price service',kind:'service',sku:'EXACT-001',description:'Source item',rate:'99.99',accountId:account('4000'),taxCategory:'non-taxable'})
  const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-12-02',lines:[{description:'Source fractional quantity',quantity:'1.001',rate:'99.99',accountId:account('4000'),taxCode:'exempt',itemId:item.id}]})
  const approved=await h.command('invoice.approve',{id:draft.id,revision:draft.revision})
  const invoice=await h.command('invoice.issue',{id:approved.id})
  const bill=await h.command('bill.save',{vendorId:vendor.id,reference:'SOURCE-BILL',billDate:'2026-12-03',lines:[{description:'Actual source expense',accountId:account('6200'),amount:'40.01'}],post:true})
  await h.command('bill.waive-evidence',{id:bill.id,revision:bill.revision,reason:'Synthetic fixture has no separately supplied vendor PDF'})
  const journal=await h.command('journal.save-draft',{date:'2026-12-04',memo:'Source one-cent journal',lines:[{accountId:account('6200'),debit:'0.01'},{accountId:account('3000'),credit:'0.01'}]})
  await h.command('journal.post',{id:journal.id,revision:journal.revision})
  const bytes=Buffer.from('Synthetic original\n\u0000Exact bytes\n')
  await h.command('document.upload',{name:'source-original.txt',mediaType:'text/plain',base64:bytes.toString('base64'),linkedKind:'journal',linkedId:journal.id})
  const pending=await h.command('journal.save-draft',{date:'2027-01-02',memo:'Draft must stay out of export',lines:[{accountId:account('6200'),debit:'9.99'},{accountId:account('3000'),credit:'9.99'}]})
  await h.command('close.tasks',{period:'2026-12'})
  for(const task of (await h.view('close/2026-12')).tasks)await h.command('close.task',{id:task.id,revision:task.revision,done:true,note:'Reviewed actual fixture records'})
  await h.command('period.lock',{period:'2026-12'})
  return {customer,vendor,item,invoice,bill,journal,bytes,pending}
}

/** Fold into an existing public-package test; intentionally adds no test registration. */
export async function destinationPortability(t) {
  const h=await harness();t.after(h.close)
  const {customer,invoice,bill,bytes,pending}=await destinationBooks(h.command,h.view)
  const endpoint=destination=>`/api/pantry/portability/export?destination=${destination}&year=2026`
  await h.view('portability/export?destination=qbo&year=2027&format=json',h.owner,409)
  const viewer=await h.member('synthetic-destination-viewer@example.test','viewer'),accountant=await h.member('synthetic-destination-accountant@example.test','accountant')
  assert.equal((await h.send(endpoint('qbo')+'&format=json')).status,401)
  await h.view('portability/export?destination=qbo&year=2026&format=json',viewer,403)
  for(const destination of ['qbo','xero']) {
    const result=await h.view(`portability/export?destination=${destination}&year=2026&format=json`,accountant)
    const {manifest:m,transport:p}=result
    assert.equal(m.destinationVerified,false)
    assert.ok(m.closingTrialBalance.balanced)
    assert.equal(m.openItems.receivables.items.find(i=>i.id===invoice.id).open,invoice.total_cents)
    assert.equal(m.openItems.payables.items.find(i=>i.id===bill.id).open,bill.total_cents)
    assert.equal(m.ledgerCoverage.representedEntries,m.ledgerCoverage.postedEntries)
    assert.ok(p.operations.some(op=>op.key===`Invoice:${invoice.id}`))
    assert.ok(p.operations.some(op=>op.key===`Bill:${bill.id}`))
    assert.ok(!p.operations.some(op=>op.journalIds.includes(pending.id)))
    assert.equal(m.documents[0].sha256,createHash('sha256').update(bytes).digest('hex'))
    const response=await fetch(h.origin+endpoint(destination)+'&format=zip',{headers:{cookie:h.owner}})
    assert.equal(response.status,200)
    const files=storedFiles(Buffer.from(await response.arrayBuffer()))
    assert.deepEqual(files.get(m.documents[0].file),bytes,'Original binary document survives the actual ZIP response')
    const manifest=JSON.parse(files.get('manifest.json'))
    for(const f of manifest.files)assert.equal(createHash('sha256').update(files.get(f.name)).digest('hex'),f.sha256,`${f.name} matches its manifest hash`)
    const contacts=files.get(destination==='qbo'?'qbo/customers.csv':'xero/contacts.csv').toString()
    assert.ok(contacts.includes("'=Synthetic"),'Formula-leading names are protected in CSV')
    const source=JSON.parse(files.get('source/contacts.json'))
    assert.equal(source.find(c=>c.id===customer.id).name,customer.name,'Exact original text remains in source JSON')
    const entries=JSON.parse(files.get('source/postedEntries.json'))
    assert.ok(!entries.some(e=>e.id===pending.id))
  }
}
