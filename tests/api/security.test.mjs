import test from 'node:test'
import assert from 'node:assert/strict'
import {books,harness} from './harness.mjs'
import {data001Journey} from './data001-journey.mjs'

test('DATA-001 actual service inventory, encrypted credential replacement, safe diagnostics and disconnected manual capture',data001Journey)

const request = (p,extra={})=>({kind:p.kind,id:p.id,fingerprint:p.fingerprint,requester:'privacy-request@example.test',channel:'email',reason:'Requested removal of obsolete personal details',confirm:'ERASE',...extra})
async function invoice(h,acct,customer,date='2026-09-02') {
  const i=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:date,lines:[{description:'Design consultation',accountId:acct['4000'],quantity:'1',rate:'100.00',taxCode:'exempt'}]})
  await h.command('invoice.approve',{id:i.id,revision:i.revision});return h.command('invoice.issue',{id:i.id})
}
async function bank(h,acct,date='2026-01-01') {return h.command('bank-account.save',{name:'Operating checking',institution:'Community Bank',accountId:acct['1000'],numberLast4:'4821',openingDate:date,openingBalance:'0.00'})}

// Reconcile the receipt against persisted changes, independently of the erasure
// compiler. Commands still enter through native authenticated HTTP routes.
async function receiptSnapshot(h) {
  const tables=(await h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'pt_*'").all()).results
  const snapshot={}
  for(const {name:table} of tables) {
    if(table.startsWith('pt_erasure_')||table.startsWith('pt_retained_'))continue
    const columns=(await h.db.prepare(`PRAGMA table_info(${table})`).all()).results
    snapshot[table]={keys:columns.filter(c=>c.pk).map(c=>c.name),rows:(await h.db.prepare(`SELECT * FROM ${table}`).all()).results}
  }
  return snapshot
}
function changedValues(before,after) {
  if(typeof before==='string')return Number(before!==after)
  if(before&&typeof before==='object')return Object.entries(before).reduce((n,[key,value])=>n+changedValues(value,after?.[key]),0)
  return 0
}
function reconcileReceipt(receipt,before,after) {
  for(const [table,{keys,rows}] of Object.entries(before)) {
    let removed=0,replaced=0,fields=0,values=0,links=0
    for(const row of rows) {
      const kept=after[table].rows.find(r=>keys.every(key=>r[key]===row[key]))
      if(!kept){removed++;continue}
      if(table==='pt_audit') {
        values+=changedValues(JSON.parse(row.detail),JSON.parse(kept.detail))
        values+=Number(row.actor_email!==kept.actor_email)+Number(row.subject_id!==kept.subject_id)
      } else if(table==='pt_approvals') {
        values+=['note','actor_email','subject_id'].filter(k=>row[k]!==kept[k]).length
      } else {
        const metadata=['revision','erased_at','revoked_at','autopay_revoked_at',...(table==='pt_contacts'?['active']:[]),...(table==='pt_invoices'?['reminders_paused','link_token']:[]),...(table==='pt_w9_requests'?['token_hash']:[])]
        const changed=Object.keys(row).filter(k=>JSON.stringify(row[k])!==JSON.stringify(kept[k])&&!metadata.includes(k))
        fields+=changed.length
        if(changed.length)replaced++
        if(table==='pt_invoices'&&row.link_token&&!kept.link_token)links++
        if(table==='pt_w9_requests'&&row.token_hash&&!kept.token_hash)links++
      }
    }
    const counts=receipt.counts[table]??{}
    assert.equal(counts.rowsRemoved??0,removed,`${table} removed rows`)
    assert.equal(counts.fieldsReplaced??0,fields,`${table} replaced fields`)
    if(table!=='pt_contacts')assert.equal((counts.rowsReplaced??0)+(counts.rowsRedacted??0),replaced,`${table} replaced rows`)
    if(table==='pt_audit'||table==='pt_approvals')assert.equal(counts.valuesReplaced??0,values,`${table} replaced history values`)
    if(table==='pt_invoices'||table==='pt_w9_requests')assert.equal(counts.linksRevoked??0,links,`${table} revoked links`)
  }
}

test('ERASURE-001 owner previews and confirms removal or personal-field markers, refuses active obligations, and keeps posted books and immutable history',async t=>{
  const h=await harness();t.after(h.close);const {acct}=await books(h),checking=await bank(h,acct)
  const lead=await h.command('contact.save',{kind:'customer',name:'Unused enquiry',email:'lead@example.test',phone:'555-0101',internalNotes:'Follow up in December'})
  const customer=await h.command('contact.save',{kind:'customer',name:'Cedar Studio LLC',email:'private@cedar.example',phone:'555-0198',billingAddress:'18 Cedar Lane',serviceAddress:'20 Cedar Lane',internalNotes:'Please use the side entrance',contacts:[{name:'Casey Cedar',email:'casey@cedar.example',phone:'555-0112',roles:['billing']}]})
  const viewer=await h.member('viewer@example.test','viewer'),accountant=await h.member('accountant@example.test','accountant',{canPost:true})
  const token=await h.command('integration.create',{name:'Invoices only',scopes:['invoices:write']}),agent=await h.agent()
  for(const op of ['erasure.preview','erasure.execute','retention.save','retention.erase']) {
    await h.command(op,{kind:'contact',id:lead.id},viewer,403);await h.command(op,{kind:'contact',id:lead.id},accountant,403)
    for(const bearer of [token.token,agent.token]) assert.equal((await h.send('/api/pantry/command/'+op,{kind:'contact',id:lead.id},{headers:{authorization:`Bearer ${bearer}`}})).status,401)
  }
  await h.view('erasure',viewer,403)
  const multi=await h.command('contact.save',{kind:'customer',name:'Shared customer LLC',contacts:[{name:'Departed buyer',email:'departed@example.test',phone:'555-0107',roles:['primary']},{name:'Current buyer',email:'current@example.test',phone:'555-0108',roles:['billing']}]})
  const personBefore=await receiptSnapshot(h)
  const personPreview=await h.command('erasure.preview',{kind:'contact-person',id:multi.id,personIndex:0})
  const personReceipt=await h.command('erasure.execute',request(personPreview,{personIndex:0}))
  reconcileReceipt(personReceipt,personBefore,await receiptSnapshot(h))
  const remaining=JSON.parse((await h.view('state')).contacts.find(c=>c.id===multi.id).contacts_json)
  assert.deepEqual(remaining.map(p=>p.email),['current@example.test'])
  assert.ok(!JSON.stringify(await h.view('activity')).includes('departed@example.test'))
  const dormant=await h.command('recurring.save',{customerId:lead.id,startDate:'2030-01-01',every:1,unit:'month',mode:'draft',lines:[{description:'Unconverted enquiry',accountId:acct['4000'],quantity:'1',rate:'50.00',taxCode:'exempt'}]})
  await h.command('recurring.status',{id:dormant.id,status:'paused'})
  const unusedProject=await h.command('time-project.save',{customerId:lead.id,name:'synthetic-pantry-41'})
  const p=await h.command('erasure.preview',{kind:'contact',id:lead.id})
  assert.equal(p.classes.find(r=>r.table==='pt_contacts').action,'removed')
  await h.command('erasure.execute',request(p,{confirm:'erase'}),h.owner,400)
  const leadBefore=await receiptSnapshot(h)
  const removal=await h.command('erasure.execute',request(p))
  reconcileReceipt(removal,leadBefore,await receiptSnapshot(h))
  assert.equal(removal.counts.pt_contacts.rowsRemoved,1)
  assert.equal(removal.counts.pt_time_projects.rowsRemoved,1)
  assert.equal((await h.view('time')).projects.some(p=>p.id===unusedProject.id),false)
  assert.equal((await h.view('state')).contacts.some(r=>r.id===lead.id),false)
  assert.ok(!JSON.stringify(removal).includes(lead.email))
  assert.ok(!JSON.stringify((await h.view('activity')).audit).includes(lead.name),'a transaction-free lead’s name has no bookkeeping retention reason')
  let i=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-09-02',memo:customer.phone,lines:[{description:'Design consultation',accountId:acct['4000'],quantity:'1',rate:'100.00',taxCode:'exempt'}]})
  let preview=await h.command('erasure.preview',{kind:'contact',id:customer.id})
  assert.ok(preview.blockers.some(r=>r.id===i.id&&r.reason==='unposted draft'))
  await h.command('erasure.execute',request(preview),h.owner,409)
  await h.command('invoice.approve',{id:i.id,revision:i.revision});i=await h.command('invoice.issue',{id:i.id})
  preview=await h.command('erasure.preview',{kind:'contact',id:customer.id})
  assert.ok(preview.blockers.some(r=>r.id===i.id&&r.reason==='open balance'))
  await h.command('erasure.execute',request(preview),h.owner,409)
  await h.command('invoice.send',{id:i.id})
  const customerLink='/i/'+(await h.view('sales')).invoices.find(r=>r.id===i.id).link_token
  assert.equal((await h.send(customerLink)).status,200)
  await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-09-05',amount:'100.00',bankAccountId:checking.id,allocations:[{targetId:i.id,amount:'100.00'}]})
  const recurring=await h.command('recurring.save',{customerId:customer.id,startDate:'2030-01-01',every:1,unit:'month',mode:'draft',lines:[{description:'Future retainer',accountId:acct['4000'],quantity:'1',rate:'100.00',taxCode:'exempt'}]})
  const recurringPreview=await h.command('erasure.preview',{kind:'contact',id:customer.id})
  assert.ok(recurringPreview.blockers.some(r=>r.id===recurring.id&&r.reason==='active recurring template'))
  await h.command('erasure.execute',request(recurringPreview),h.owner,409)
  await h.command('recurring.status',{id:recurring.id,status:'paused'})
  const before=await h.view('reports/trial-balance?to=2026-12-31&basis=accrual'),history=(await h.view('activity')).audit
  const pdf=await h.view(`invoice-documents/${i.id}/preview`)
  preview=await h.command('erasure.preview',{kind:'contact',id:customer.id})
  assert.equal(preview.blockers.length,0)
  assert.ok(preview.classes.some(r=>r.table==='pt_invoice_documents'&&r.expires&&r.reason))
  const stale=await h.command('contact.save',{...customer,kind:'customer',id:customer.id,revision:customer.revision,name:customer.name,email:customer.email,internalNotes:'Updated privacy note'})
  await h.command('erasure.execute',request(preview),h.owner,409)
  preview=await h.command('erasure.preview',{kind:'contact',id:customer.id})
  const copiesBefore=await receiptSnapshot(h)
  const receipt=await h.command('erasure.execute',request(preview))
  reconcileReceipt(receipt,copiesBefore,await receiptSnapshot(h))
  const retained=(await h.view('state')).contacts.find(r=>r.id===customer.id)
  assert.equal(retained.name,'Cedar Studio LLC');assert.equal(retained.email,'[erased]');assert.equal(retained.phone,'[erased]');assert.equal(retained.billing_address,'[erased]');assert.equal(retained.service_address,'[erased]');assert.equal(retained.internal_notes,'[erased]');assert.deepEqual(JSON.parse(retained.contacts_json),[])
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31&basis=accrual'),before)
  const after=(await h.view('activity')).audit
  for(const entry of history){const kept=after.find(e=>e.id===entry.id);assert.ok(kept);for(const key of ['at','action','subject_revision','approval_id'])assert.equal(kept[key],entry[key])}
  const serialized=JSON.stringify(after)
  for(const personal of [customer.email,customer.phone,customer.billing_address,'casey@cedar.example','Please use the side entrance',stale.internal_notes])assert.ok(!serialized.includes(personal),personal)
  assert.ok(after.some(e=>JSON.parse(e.detail).erasure?.id===receipt.id))
  assert.equal((await h.view(`invoice-documents/${i.id}/preview`)).sha256,pdf.sha256)
  assert.equal((await h.view('sales')).invoices.find(r=>r.id===i.id).link_token,null)
  assert.equal((await h.view('sales')).invoices.find(r=>r.id===i.id).memo,'[erased]')
  assert.equal(receipt.counts.pt_invoices.linksRevoked,1)
  assert.deepEqual(receipt.retained.map(r=>[r.table,r.id,r.expires]),[['pt_invoice_documents',i.id,'2033-09-05']])
  assert.match(receipt.retained[0].reason,/Supports posted entries/)
  assert.equal((await h.view('erasure')).receipts.find(r=>r.id===receipt.id).id,receipt.id)
  for(const path of [customerLink,customerLink+'/invoice.pdf'])assert.equal((await h.send(path)).status,404)
  assert.equal((await h.send(customerLink+'/pay',undefined,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:'method=card'})).status,404)
  await h.command('contact.save',{kind:'customer',id:customer.id,revision:retained.revision,name:retained.name,email:'restore@example.test'},h.owner,409)
  await assert.rejects(h.db.prepare("UPDATE pt_audit SET detail='{}' WHERE id=?").bind(history[0].id).run(),/IMMUTABLE/)
  assert.ok(!JSON.stringify(receipt).includes(customer.email))
  // New time support follows the same active-obligation and retained-books
  // rules; erasure changes neither invoiced hours nor the issued document.
  const timedCustomer=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-42',email:'synthetic-pantry-42@example.test'})
  const timedService=await h.command('item.save',{name:'synthetic-pantry-43',kind:'service',rate:'25',accountId:acct['4000'],taxCategory:'non-taxable'})
  const timedProject=await h.command('time-project.save',{customerId:timedCustomer.id,name:'synthetic-pantry-44'})
  const time=await h.command('time.save',{customerId:timedCustomer.id,projectId:timedProject.id,itemId:timedService.id,date:'2026-09-02',hours:'4',note:timedCustomer.email})
  const waiting=await h.command('erasure.preview',{kind:'contact',id:timedCustomer.id})
  assert.ok(waiting.blockers.some(r=>r.kind==='time'&&r.id===time.id&&/unbilled/.test(r.reason)))
  await h.command('erasure.execute',request(waiting),h.owner,409)
  const timedDraft=await h.command('invoice.save-draft',{customerId:timedCustomer.id,issueDate:'2026-09-02',lines:[]})
  await h.command('invoice.approve',{id:timedDraft.id,revision:timedDraft.revision})
  const timedInvoice=await h.command('invoice.issue',{id:timedDraft.id})
  await h.command('payment.record',{direction:'received',contactId:timedCustomer.id,date:'2026-09-05',amount:'100',bankAccountId:checking.id,allocations:[{targetId:timedInvoice.id,amount:'100'}]})
  const timedPdf=await h.view(`invoice-documents/${timedInvoice.id}/preview`),timeBefore=(await h.view('time')).entries.find(r=>r.id===time.id)
  const timedBooks=await h.view('reports/trial-balance?to=2026-12-31&basis=accrual')
  const timedPreview=await h.command('erasure.preview',{kind:'contact',id:timedCustomer.id})
  assert.ok(timedPreview.classes.some(r=>r.table==='pt_time_entries'&&/hours/.test(r.reason)))
  const timedReceipt=await h.command('erasure.execute',request(timedPreview))
  const timeAfter=(await h.view('time')).entries.find(r=>r.id===time.id)
  for(const field of ['id','person_email','recorded_by','customer_id','project_id','item_id','work_date','minutes','invoiced'])assert.equal(timeAfter[field],timeBefore[field])
  assert.equal(timeAfter.note,'[erased]')
  assert.deepEqual((await h.view('sales')).invoices.find(r=>r.id===timedInvoice.id).lines,timedInvoice.lines)
  assert.equal((await h.view(`invoice-documents/${timedInvoice.id}/preview`)).sha256,timedPdf.sha256)
  assert.equal(timedReceipt.counts.pt_time_entries.rowsRetained,1)
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31&basis=accrual'),timedBooks)
})

test('ERASURE-001 a deactivated member loses identity and sessions while a stable Former member label preserves approvals and Activity',async t=>{
  const h=await harness();t.after(h.close);const {acct}=await books(h)
  const email='blair@example.test',cookie=await h.member(email,'bookkeeper',{canPost:true})
  await h.command('contact.save',{kind:'vendor',name:'Blair supplied vendor'},cookie)
  const entry=await h.command('journal.save-draft',{date:'2026-09-04',memo:'Office supplies',lines:[{accountId:acct['6100'],debit:'25.00'},{accountId:acct['1000'],credit:'25.00'}]})
  await h.command('journal.post',{id:entry.id,revision:entry.revision},cookie)
  await h.command('erasure.preview',{kind:'member',id:'owner@example.test'},h.owner,409)
  await h.command('erasure.preview',{kind:'member',id:email},h.owner,409)
  const delegateEmail='synthetic-pantry-45@example.test',delegate=await h.member(delegateEmail,'time-only',{timePeople:[email]})
  await h.command('member.save',{email,name:'blair',role:'bookkeeper',canPost:true,timePeople:[delegateEmail]})
  const timeCustomer=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-46'})
  const timeService=await h.command('item.save',{name:'synthetic-pantry-47',kind:'service',rate:'25',accountId:acct['4000'],taxCategory:'non-taxable'})
  const timeProject=await h.command('time-project.save',{customerId:timeCustomer.id,name:'synthetic-pantry-48'})
  const timeBody={customerId:timeCustomer.id,projectId:timeProject.id,itemId:timeService.id,date:'2026-09-04',hours:'4',note:email}
  const ownTime=await h.command('time.save',timeBody,cookie)
  const delegatedTime=await h.command('time.save',{...timeBody,personEmail:delegateEmail,hours:'1'},cookie)
  const timeDraft=await h.command('invoice.save-draft',{customerId:timeCustomer.id,issueDate:'2026-09-04',lines:[]})
  await h.command('invoice.approve',{id:timeDraft.id,revision:timeDraft.revision})
  const timeInvoice=await h.command('invoice.issue',{id:timeDraft.id})
  const history=(await h.view('activity')).audit,totals=await h.view('reports/trial-balance?to=2026-12-31')
  await h.command('member.save',{email,name:'blair',role:'bookkeeper',active:false})
  const p=await h.command('erasure.preview',{kind:'member',id:email}),receipt=await h.command('erasure.execute',request(p))
  assert.match(receipt.marker,/^Former member [a-f0-9]{8}$/)
  await h.view('state',cookie,401)
  const activity=await h.view('activity')
  assert.ok(activity.audit.some(e=>e.actor_email===receipt.marker));assert.ok(!JSON.stringify(activity).includes(email))
  for(const e of history){const kept=activity.audit.find(r=>r.id===e.id);assert.equal(kept.at,e.at);assert.equal(kept.action,e.action);assert.equal(kept.approval_id,e.approval_id)}
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31'),totals)
  assert.ok(!JSON.stringify(await h.view('journal')).includes(email),'posted attribution no longer exposes an erased identity')
  assert.equal((await h.db.prepare('SELECT count(*) AS n FROM oa_sessions se JOIN oa_operators o ON o.id=se.operator_id WHERE o.email=?').bind(email).first()).n,0)
  const allTime=(await h.view('time')).entries,keptOwn=allTime.find(r=>r.id===ownTime.id),keptDelegated=allTime.find(r=>r.id===delegatedTime.id)
  assert.equal(keptOwn.person_email,receipt.marker);assert.equal(keptOwn.recorded_by,receipt.marker);assert.equal(keptOwn.minutes,240);assert.equal(keptOwn.invoiced,1)
  assert.equal(keptDelegated.person_email,delegateEmail);assert.equal(keptDelegated.recorded_by,receipt.marker);assert.equal(keptDelegated.minutes,60);assert.equal(keptDelegated.invoiced,1)
  assert.ok(!JSON.stringify(allTime).includes(email))
  const people=(await h.view('state')).settings.members
  assert.deepEqual(JSON.parse(people.find(m=>m.email===delegateEmail).time_people),[])
  assert.deepEqual(JSON.parse(people.find(m=>m.email===receipt.marker).time_people),[])
  assert.equal(receipt.counts.pt_time_entries.rowsReplaced,2)
  assert.equal(receipt.counts.pt_members.delegationsRemoved,2)
  assert.deepEqual((await h.view('sales')).invoices.find(r=>r.id===timeInvoice.id).lines,timeInvoice.lines)
  await h.command('time.save',{...timeBody,personEmail:email},delegate,403)

})

test('ERASURE-001 retention recomputes unerased supporting items, requires confirmation, keeps hashes and never regenerates expired bytes or TINs',async t=>{
  const h=await harness();t.after(h.close)
  await h.command('entity.save',{legalName:'Cedar Archive LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2010-01-01',policies:''});await h.command('chart.start',{})
  const acct=Object.fromEntries((await h.view('state')).accounts.map(a=>[a.code,a.id])),checking=await bank(h,acct,'2010-01-01')
  const customer=await h.command('contact.save',{kind:'customer',name:'Archive Customer LLC',email:'archive@example.test',billingAddress:'8 Archive Road'})
  const i=await invoice(h,acct,customer,'2018-09-01')
  await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2018-09-05',amount:'100.00',bankAccountId:checking.id,allocations:[{targetId:i.id,amount:'100.00'}]})
  const pdf=await h.view(`invoice-documents/${i.id}/preview`)
  const vendor=await h.command('contact.save',{kind:'vendor',name:'Archive Vendor LLC',address:'14 Vendor Road',phone:'555-0173'})
  await h.command('contractor.save',{contactId:vendor.id,is1099:true,legalName:'Archive Vendor LLC',tinKind:'ein',tin:'111223333',address:'14 Vendor Road',city:'Albany',state:'NY',zip:'12207'})
  const requestW9=await h.command('w9.request',{contactId:vendor.id,contactRevision:(await h.view(`vendor-w9/${vendor.id}`)).contactRevision,consent:true})
  const certification=await h.send(new URL(requestW9.url).pathname,undefined,{raw:new URLSearchParams({legalName:'Archive Vendor LLC',tinKind:'ein',tin:'111223333',classification:'individual',address:'14 Vendor Road',city:'Albany',state:'NY',zip:'12207',signature:'Archive Vendor',certify:'yes'}).toString(),headers:{'content-type':'application/x-www-form-urlencoded'}})
  assert.equal(certification.status,200)
  assert.equal((await h.view(`vendor-w9/${vendor.id}`)).status,'complete')
  const bill=await h.command('bill.save',{vendorId:vendor.id,reference:'ARCHIVE-18',billDate:'2018-09-01',post:true,lines:[{description:'Archive consulting',accountId:acct['6100'],amount:'25.00'}]})
  await h.command('payment.record',{direction:'paid',contactId:vendor.id,date:'2018-09-06',amount:'25.00',method:'ach',bankAccountId:checking.id,allocations:[{targetId:bill.id,amount:'25.00'}]})
  const adjustment=await h.command('journal.save-draft',{date:'2018-09-07',memo:'Historical contractor adjustment',lines:[{accountId:acct['6100'],debit:'5.00',contactId:vendor.id},{accountId:acct['1000'],credit:'5.00'}]})
  await h.command('journal.post',{id:adjustment.id,revision:adjustment.revision})
  await h.command('journal.reclassify',{lineIds:[adjustment.lines.find(l=>l.account_id===acct['6100']).id],toAccountId:acct['6200'],memo:'Correct expense coding'})
  await h.command('journal.reverse',{id:adjustment.id,date:'2020-09-07',memo:'Later reversal of historical adjustment'})
  const retainedPreview=await h.command('erasure.preview',{kind:'contact',id:vendor.id})
  assert.equal(retainedPreview.retained.find(r=>r.table==='pt_contractor_tax').clock,'2020-09-07','latest financial event includes reversal and correction lineage')
  const source=await h.command('document.upload',{name:'archive-consulting.txt',mediaType:'text/plain',base64:Buffer.from('Archive Vendor invoice ARCHIVE-18').toString('base64'),linkedKind:'bill',linkedId:bill.id})
  const pendingW9=await h.command('w9.request',{contactId:vendor.id,contactRevision:(await h.view(`vendor-w9/${vendor.id}`)).contactRevision,consent:true})
  const privatePath=new URL(pendingW9.url).pathname
  assert.equal((await h.send(privatePath)).status,200)
  for(const subject of [customer,vendor]) {
    const p=await h.command('erasure.preview',{kind:'contact',id:subject.id}),before=await receiptSnapshot(h)
    const receipt=await h.command('erasure.execute',request(p))
    reconcileReceipt(receipt,before,await receiptSnapshot(h))
    const retained=(await h.view('state')).contacts.find(c=>c.id===subject.id)
    for(const field of ['email','phone','address','billing_address','service_address','internal_notes','bank_reference','external_ref'])assert.equal(retained[field],'[erased]',field)
    assert.equal(retained.contacts_json,'[]');assert.equal(retained.name,subject.name)
    const evidence=receipt.retained.map(r=>[r.table,r.id,r.clock,r.expires])
    if(subject.id===vendor.id) {
      assert.equal(receipt.counts.pt_w9_requests.linksRevoked,1)
      assert.equal((await h.send(privatePath)).status,404)
      assert.ok(p.classes.some(r=>r.table==='pt_w9_requests'&&r.reason))
      assert.ok(evidence.some(r=>r[0]==='pt_contractor_tax'&&r[1]===vendor.id&&r[2]==='2020-09-07'&&r[3]==='2027-09-07'))
      assert.ok(evidence.some(r=>r[0]==='pt_documents'&&r[1]===source.id))
      for(const field of ['address','city','state','zip'])assert.equal((await h.db.prepare('SELECT * FROM pt_contractor_tax WHERE contact_id=?').bind(vendor.id).first())[field],'[erased]')
    }
  }
  let view=await h.view('erasure');assert.ok(view.ready.length>=1)
  await h.command('retention.save',{years:0,revision:view.revision},h.owner,400)
  await h.command('retention.save',{years:10,revision:view.revision});view=await h.view('erasure');assert.equal(view.ready.length,0)
  await h.command('retention.save',{years:1,revision:view.revision});view=await h.view('erasure');assert.ok(view.ready.length>=3);assert.match(view.warning,/3 years|three years/)
  const ids=view.ready.map(r=>r.id)
  await h.command('retention.erase',{ids,revision:view.revision,confirm:'no'},h.owner,400)
  assert.equal((await h.send('/api/pantry/documents/'+source.id,undefined,{cookie:h.owner})).status,200)
  const receipt=await h.command('retention.erase',{ids,revision:view.revision,confirm:'ERASE'})
  assert.ok(receipt.id)
  assert.equal((await h.send('/api/pantry/documents/'+source.id,undefined,{cookie:h.owner})).status,410)
  await h.view(`invoice-documents/${i.id}/preview`,h.owner,410)
  const sales=await h.view('sales');assert.equal(sales.invoices.find(r=>r.id===i.id).issued_pdf_sha256,pdf.sha256)
  assert.equal((await h.db.prepare('SELECT tin FROM pt_contractor_tax WHERE contact_id=?').bind(vendor.id).first()).tin,null)
  const expiredTax=await h.db.prepare('SELECT w9_evidence_sealed,w9_evidence_history,w9_completed_at FROM pt_contractor_tax WHERE contact_id=?').bind(vendor.id).first()
  assert.deepEqual(expiredTax,{w9_evidence_sealed:null,w9_evidence_history:'[]',w9_completed_at:null})
  assert.equal((await h.view(`vendor-w9/${vendor.id}`)).status,'missing')
  const docs=(await h.view('documents')).documents;assert.equal(docs.find(r=>r.id===source.id).sha256,source.sha256)
  view=await h.view('erasure');await h.command('retention.save',{years:20,revision:view.revision});assert.equal((await h.view('erasure')).ready.length,0)
  await h.view(`invoice-documents/${i.id}/preview`,h.owner,410)
})
