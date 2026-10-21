// Deliberate, previewed erasure and owner-confirmed retention expiry.
import { useState } from 'react'
import { Card, Field, Form, Loading, Table, command, useShared, useView, type D } from './kit'

export function ErasureSettings() {
  const {state,reload} = useShared(), {data,error,reload:refresh} = useView<D>('erasure')
  const [preview,setPreview] = useState<D|null>(null), [receipt,setReceipt] = useState<D|null>(null)
  if (!data) return <Loading error={error} what="erasure and retention" />
  const subjects = [...state.contacts.filter((r:D)=>!r.erased_at).map((c:D)=>({value:`contact:${c.id}`,label:`${c.name} · ${c.kind}`})),
    ...state.settings.members.filter((m:D)=>!m.active && !m.email.startsWith('Former member ')).map((m:D)=>({value:`member:${m.email}`,label:`${m.name} · deactivated member`}))]
  const done = async (result:D) => {setReceipt(result);setPreview(null);await reload();await refresh()}
  return <>
    <Card title="Erase personal data">
      <p>Record a person’s request, preview what will be removed or retained, then confirm. Posted accounting facts stay. Connected services, downloaded files and earlier backups are outside this erasure.</p>
      <Form label="Preview erasure" submit={async b=>{const [kind,...id]=String(b.subject).split(':');return command('erasure.preview',{kind,id:id.join(':')})}} onDone={r=>{setPreview(r);setReceipt(null)}} className="grid-form">
        <Field label="Person or contact" name="subject" required options={subjects} />
      </Form>
      {preview && <section aria-label="Erasure preview">
        <h3>Erasure preview · {preview.label}</h3>
        <Table heads={['Record class','Action','Reason / expiry']} empty="No records.">{preview.classes.map((r:D,i:number)=><tr key={i}><td>{r.table}{r.id&&<small className="sub">{r.id}</small>}</td><td>{r.action}</td><td>{r.reason}{r.expires&&<small className="sub">Retained until {r.expires}</small>}</td></tr>)}</Table>
        {preview.blockers.length ? <div role="alert" className="callout callout-warn"><strong>Resolve these records before erasure</strong>{preview.blockers.map((r:D)=><p key={r.kind+r.id}>{r.kind} {r.number??r.id}: {r.reason}</p>)}</div> : <Form label="Erase personal data" submit={b=>command('erasure.execute',{...b,kind:preview.kind,id:preview.id,fingerprint:preview.fingerprint})} onDone={done} className="grid-form">
          <Field label="Requester" name="requester" required hint="Who asked for this erasure" /><Field label="Request channel" name="channel" options={['email','phone','in-person','other'].map(value=>({value,label:value}))} required />
          <Field label="Reason for erasure" name="reason" type="textarea" required /><Field label="Type ERASE to confirm" name="confirm" required />
        </Form>}
      </section>}
      {receipt&&<section role="status"><h3>Erasure receipt · {receipt.id}</h3><p>Erasure completed. The journal prevents older archives from restoring erased values when its history is known.</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(receipt,null,2)}</pre></section>}
    </Card>
    <Card title="Retention and ready to erase">
      <p>TINs and supporting documents are retained from the latest posted transaction they support, including corrections and reversals. Expiry proposes removal; it never deletes automatically. No legal adequacy is asserted.</p>
      <Form label="Save retention period" submit={b=>command('retention.save',{...b,revision:data.revision})} onDone={async()=>{setPreview(null);await refresh()}} className="grid-form"><Field label="Retention in whole years" name="years" type="number" min="1" step="1" defaultValue={data.years} required /></Form>
      {data.warning&&<p className="callout callout-warn">{data.warning}</p>}
      <Table heads={['Record','Retained until','Status']} empty="No records retained by erasure.">{data.items.map((r:D)=><tr key={r.id}><td>{r.table}<small className="sub">{r.row_id??r.record_id??r.id}</small></td><td>{r.expires}</td><td>{r.erased_at?'Erased':r.expires<=new Date().toISOString().slice(0,10)?'Ready to erase':'Retained'}</td></tr>)}</Table>
      <h3>Ready to erase</h3>
      {data.ready.length ? <Form label="Confirm expired items" submit={b=>command('retention.erase',{...b,ids:data.ready.map((r:D)=>r.id),revision:data.revision})} onDone={done} className="grid-form"><p>{data.ready.length} expired supporting items. Record numbers, totals, revisions and SHA-256 remain.</p><Field label="Type ERASE for expired items" name="confirm" required /></Form> : <p>No expired items awaiting confirmation.</p>}
    </Card>
  </>
}
