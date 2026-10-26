import { useState } from 'react'
import { Action, Card, Chip, Field, Form, Loading, Table, command, day, useShared, useView, type D } from './kit'

export function TextingSettings() {
 const {data,error,reload}=useView<D>('texting')
 if(!data)return <Card title="Texting"><Loading error={error} what="texting settings" /></Card>
 const s=data.settings
 return <Card title="Texting" actions={<Chip tone={s.enabled?'info':'neutral'}>{s.enabled?'Test texting enabled':'Off'}</Chip>}>
  <p>Send hosted invoice links and reminders through your business’s Twilio test account. Test requests send no real SMS. Your email history stays on the invoice.</p>
  <details className="details"><summary>Twilio registration, fees and data</summary><p className="hint">Only test messaging is available. Before live US business texting, register an A2P 10DLC brand and campaign in Twilio, or verify a toll-free sender. Twilio bills your account for live messages and carrier fees. Pantry sends the customer’s number, exact text and hosted link directly to Twilio, which returns a message ID and status.</p></details>
  <details className="details"><summary>{s.connected?'Replace Twilio test account':'Connect Twilio test account'}</summary>
   <Form label="Connect test account" submit={b=>command('texting.connect',{testAccountSid:b.testAccountSid,testAuthToken:b.testAuthToken,confirmTestOnly:b.confirmTestOnly==='on'})} onDone={reload}>
    <Field label="Twilio test account SID" name="testAccountSid" required autoComplete="off" />
    <Field label="Twilio test auth token" name="testAuthToken" type="password" required autoComplete="new-password" />
    <label className="check"><input type="checkbox" name="confirmTestOnly" required />These are Twilio test credentials. No real SMS will be sent.</label>
   </Form>
  </details>
  <Form key={s.revision} label="Approve text settings" submit={b=>command('texting.settings',{revision:s.revision,enabled:b.enabled==='on',businessContact:b.businessContact,invoiceTemplate:b.invoiceTemplate,reminderTemplate:b.reminderTemplate,reminderDays:b.reminderDays,approve:b.approve==='on'})} onDone={reload}>
   <label className="check"><input type="checkbox" name="enabled" defaultChecked={s.enabled} disabled={!s.connected} />Enable consented test texts</label>
   <Field label="Business contact for HELP" name="businessContact" defaultValue={s.businessContact} required hint="Include your business name and a support phone number or email." />
   <Field label="Invoice text template" name="invoiceTemplate" type="textarea" defaultValue={s.invoiceTemplate} required />
   <Field label="Text reminder template" name="reminderTemplate" type="textarea" defaultValue={s.reminderTemplate} required />
   <Field label="Text reminder days" name="reminderDays" defaultValue={s.reminderDays.join(', ')} hint="Days before (negative) or after the due date. Empty turns automatic texts off. A customer override can narrow these approved days." />
   <p className="hint">Fields: {'{{business}}, {{customer}}, {{invoice}}, {{balance}}, {{due_date}}, {{link}}'}. Include the link, STOP and HELP. Texts wait until 08:00–21:00 in the customer’s time zone and 08:00–18:00 in the business’s time zone. STOP cancels held texts immediately.</p>
   <label className="check"><input type="checkbox" name="approve" required />I approve these exact templates and reminder days for the consented purposes.</label>
  </Form>
  {s.connected&&<Action tone="danger" run={async()=>{await command('texting.disconnect',{});await reload()}}>Disconnect Twilio</Action>}
  <p className="hint">{s.updatedAt?<>Last changed {day(s.updatedAt)} by {s.updatedBy}.</>:'No provider connected.'} Test-account callbacks shown in history are synthetic signed test events, not evidence of real carrier delivery.</p>
 </Card>
}

export function CustomerTextConsent({customer}:{customer:D}) {
 const {data,error,reload}=useView<D>('texting'),[purposes,setPurposes]=useState<string[]>(['invoice','reminder'])
 if(!data)return <Card title="Customer text consent"><Loading error={error} what="text consent" /></Card>
 const consents=data.consents.filter((c:D)=>c.customer_id===customer.id)
 return <Card title="Customer text consent">
  <p>Record the customer’s permission for each number and purpose before Pantry sends a text. Sharing from your own phone is recorded separately.</p>
  <Form label="Record text consent" submit={b=>command('texting.consent',{customerId:customer.id,phone:b.phone,timeZone:b.timeZone,source:b.source,wording:b.wording,consentedAt:new Date(b.consentedAt).toISOString(),purposes})} onDone={reload}>
   <Field label="Consented mobile number" name="phone" type="tel" defaultValue={customer.phone} required placeholder="+1…" />
   <Field label="Customer time zone" name="timeZone" required placeholder="America/New_York" />
   <fieldset><legend>Consented text purposes</legend>{['invoice','reminder','estimate'].map(p=><label className="check" key={p}><input type="checkbox" checked={purposes.includes(p)} onChange={e=>setPurposes(v=>e.target.checked?[...v,p]:v.filter(x=>x!==p))} />{p==='invoice'?'Invoice links':p==='reminder'?'Invoice reminders':'Estimate links'}</label>)}</fieldset>
   <Field label="Consent source" name="source" required hint="Where the customer gave permission, such as a signed form or email." />
   <Field label="Exact consent wording" name="wording" type="textarea" required />
   <Field label="Consent given at" name="consentedAt" type="datetime-local" required hint="Use the time the customer gave permission, in your device’s time zone." />
  </Form>
  <Table heads={['Number','Purposes','Consent evidence','Status']} empty="No text consent recorded.">
   {consents.map((c:D)=><tr key={c.phone}><td>{c.phone}<small className="sub block">{c.time_zone}</small></td><td>{c.purposes.join(', ')}</td><td><details><summary>{c.source}</summary><p>{c.wording}</p><p>Given {new Date(c.consented_at).toLocaleString()}. Recorded {new Date(c.recorded_at).toLocaleString()} by {c.recorded_by}.</p></details></td><td>{c.revoked_at?<Chip tone="warn">Opted out</Chip>:<><Chip tone="good">Consented</Chip><Action tone="danger" run={async()=>{await command('texting.consent',{customerId:customer.id,phone:c.phone,revoke:true});await reload()}}>Revoke text consent</Action></>}</td></tr>)}
  </Table>
 </Card>
}

export function InvoiceTexting({invoice,kind='invoice'}:{invoice:D;kind?:'invoice'|'estimate'}) {
 const {state}=useShared(),{data,error,reload}=useView<D>(state.actor.can.owner?'texting':null),[phone,setPhone]=useState(''),[shareError,setShareError]=useState(''),[busy,setBusy]=useState(false)
 const customer=state.contacts.find((c:D)=>c.id===invoice.customer_id),number=phone||customer?.phone||'',path=kind==='estimate'?invoice.public_path:invoice.link_token?`/i/${invoice.link_token}`:null
 if(!path||invoice.void_date||!['issued','sent','accepted'].includes(invoice.status))return null
 const ownBody=`${state.entity?.legal_name??state.settings?.entity?.legal_name??'Business'}: ${invoice.number} ${path?window.location.origin+path:''}`
 const href=`sms:${number.replace(/[\s().-]/g,'')}?body=${encodeURIComponent(ownBody)}`
 const messages=(data?.messages??[]).filter((m:D)=>m.subject_id===invoice.id),shares=(data?.shares??[]).filter((s:D)=>s.subject_id===invoice.id)
 return <section aria-label="Text invoice link" className="stack">
  <h3>Text the link</h3>
  {state.actor.can.record&&<>
   <Field label="Text link to mobile number" name="textPhone" type="tel" value={number} onChange={(e:any)=>setPhone(e.target.value)} />
   <a className="btn btn-secondary" href={href} aria-disabled={busy} onClick={async e=>{
    e.preventDefault();if(busy)return;setBusy(true);setShareError('')
    try{const shared=await command('texting.share',{id:invoice.id,kind,phone:number});await reload();window.location.href=shared.smsUri}catch(error){setShareError((error as Error).message)}finally{setBusy(false)}
   }}>{busy?'Recording share…':'Text the link'}</a>
   {shareError&&<p className="error" role="alert">{shareError}</p>}
   <p className="hint">Opens your phone’s messaging app. Pantry records who shared the link and when; your phone sends the message.</p>
  </>}
  {state.actor.can.owner&&data?.settings.enabled&&<Action run={async()=>{await command('texting.send',{id:invoice.id,kind,purpose:kind,phone:number||undefined,requestId:crypto.randomUUID()});await reload()}}>Send test text from Pantry</Action>}
  {error&&<p role="alert" className="error">{error}</p>}
  {shares.length+messages.length===0&&<p>No text activity recorded.</p>}
  <ul className="send-log">
   {shares.map((s:D)=><li key={s.id}><span><strong>Own phone</strong> · {s.phone}</span><small>{day(s.at)} · {s.actor_email}</small><small>Link shared; sending happens on the phone</small></li>)}
   {messages.map((m:D)=><li key={m.id}><span><strong>Twilio test · {m.purpose}</strong> · {m.phone}</span><Chip tone={m.status==='delivered'?'good':['failed','undeliverable','uncertain'].includes(m.status)?'warn':'neutral'}>{m.status}</Chip><small>{day(m.at)} · {m.actor_email}</small><details style={{gridColumn:'1 / -1',overflowWrap:'anywhere'}}><summary>Text outcomes</summary><p>{m.body}</p>{m.not_before&&<p>Held until {new Date(m.not_before).toLocaleString()}.</p>}<p>{m.detail}</p>{m.provider_message_id&&<p>{m.provider_message_id}</p>}{m.events.map((e:D)=><p key={e.id}>{e.status} · {new Date(e.at).toLocaleString()} · {e.detail}</p>)}</details></li>)}
  </ul>
 </section>
}
