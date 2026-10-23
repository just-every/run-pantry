import { Card,Field,Form,PageHead,Table,command,day,usd,useView,Loading,type D } from './kit'
export function Collections(){const {data,error,reload}=useView<D>('collections')
 if(!data)return <Loading error={error} what="collection drafts"/>
 return <><PageHead title="Collection drafts" lead="Review the facts and exact message before sending. Promises, disputes and paid invoices stay out of chasing."/>
 <Card title="Overdue work"><Form label="Prepare overdue drafts" submit={()=>command('collections.prepare',{})} onDone={reload} children={null}/><p>No message sends automatically. A payment in progress pauses sending. Invoices issued by another app stay with that app.</p></Card>
 {data.cases.map((c:D)=><Card key={c.invoice_id} title={`${c.number} · ${c.customer}`}>
 <p>{usd(c.currentOpen)} currently open · {c.currentStatus}. <a href={'/app/sales?invoice='+c.invoice_id}>Open invoice</a></p>
 {c.promise_date&&<p>Paused through {c.promise_date}. {c.reply_note}</p>}
 <p>Reviewed recipient: {c.recipient}</p>
 <details><summary>Payment and correspondence evidence</summary><p>Invoice due {c.evidence.dueDate}; draft prepared from {usd(c.evidence.openCents)} open.</p>
 <Table heads={['Payment date','Reference','Amount']} figures={[2]} empty="No prior payments are recorded for this customer.">{c.evidence.paymentHistory.map((p:D,i:number)=><tr key={i}><td>{day(p.payment_date)}</td><td>{p.reference||'—'}</td><td>{usd(p.amount_cents)}</td></tr>)}</Table>
 <Table heads={['Prior invoice message','Outcome','Date']} empty="No previous invoice correspondence is recorded.">{c.evidence.correspondence.map((d:D)=><tr key={d.id}><td>{d.subject}</td><td>{d.status}</td><td>{day(d.at)}</td></tr>)}</Table>
 </details>
 {!['paid','disputed','stopped'].includes(c.currentStatus)&&<><Form label="Save collection draft" submit={b=>command('collections.save',{...b,id:c.invoice_id,revision:c.revision})} onDone={reload}>
 <Field label="Collection subject" name="subject" defaultValue={c.subject} required maxLength={200}/><Field label="Collection message" name="body" type="textarea" defaultValue={c.body} required maxLength={4000}/>
 </Form>
 {c.status==='draft'&&<Form label="Approve this exact draft" submit={()=>command('collections.approve',{id:c.invoice_id,revision:c.revision})} onDone={reload} children={null}/>}
 {c.status==='approved'&&<Form label="Send approved draft" submit={()=>command('collections.send',{id:c.invoice_id,revision:c.revision})} onDone={reload} children={null}/>}</>}
 {c.currentStatus!=='paid'&&<details><summary>Record a reply or stop chasing</summary><Form label="Record collection decision" submit={b=>command('collections.hold',{...b,id:c.invoice_id,revision:c.revision})} onDone={reload}>
 <Field label="Collection decision" name="status" options={[{value:'promise',label:'Promise to pay'},{value:'disputed',label:'Customer disputes this invoice'},{value:'stopped',label:'Owner stops chasing'},{value:'draft',label:'Owner resumes draft review'}]} required/>
 <Field label="Promised payment date" name="promiseDate" type="date" min={data.today}/><Field label="Customer reply or owner reason" name="note" type="textarea" required/>
 <p>Promises and stops also pause ordinary invoice reminders. Resuming draft review leaves those reminders paused until the owner changes invoice settings.</p>
 </Form></details>}
 <Table heads={['Collection send','Outcome','Detail']} empty="No collection messages claimed for this invoice.">{c.sends.map((s:D)=><tr key={s.id}><td>{day(s.at)}</td><td>{s.status}</td><td>{s.detail||'—'}</td></tr>)}</Table>
 </Card>)}
 </>
}
