import { useState } from 'react'
import { Card,Field,Form,Table,command,day,usd,useView,useShared,type D } from './kit'
export function LearnedRecognition(){
 const {data,reload}=useView<D>('learned-recognition'),{state}=useShared(),can=state.actor.can.record&&['owner','accountant'].includes(state.actor.role)
 if(!data)return null
 return <Card title="Repeated resolutions"><p>Repeated answers can suggest a narrowly scoped recognition plan. The back-test and each source-funded plan stay reviewable; posting always needs the plan’s own approval.</p>
 {can&&<Form label="Look for repeated resolutions" submit={()=>command('learned.check',{})} onDone={reload} children={null}/>}
 {!data.proposals.length&&<p>No repeated funding pattern is ready for review.</p>}
 {data.proposals.map((p:D)=><LearnedProposal key={p.id} p={p} can={can} onDone={reload}/>)}
 </Card>
}
function LearnedProposal({p,can,onDone}:{p:D;can:boolean;onDone:()=>Promise<void>}){
 const {state}=useShared(),[review,setReview]=useState<D|null>(null),test=review?.test??(p.backtest.months?p.backtest:null),money=(n:number)=>(n/100).toFixed(2)
 return <section className="stack"><h3>{p.vendor} · {p.months}-month prepaid proposal</h3><p>{p.status} · source account {p.balance_account}</p>
 <Table heads={['Resolved question','Funding date','Source','Amount']} figures={[3]}>{p.evidence.map((e:D)=><tr key={e.questionId}><td><a href={'/app/questions?q='+e.questionId}>{e.answer}</a></td><td>{day(e.date)}</td><td><a href={'/app/search?type=journal&record='+e.sourceJournalId}>Funding journal</a></td><td>{usd(e.amount)}</td></tr>)}</Table>
 {can&&p.status==='proposed'&&<Form label="Back-test prior year" submit={async b=>{const test=await command('learned.preview',{...b,id:p.id,revision:p.revision});setReview({...b,test});return test}}>
 <Field label="Recognition expense account" name="recognitionAccountId" options={state.accounts.filter((a:D)=>a.type==='expense'&&a.active).map((a:D)=>({value:a.id,label:`${a.code} · ${a.name}`}))} required/>
 <Field label="Back-test through" name="asOf" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/>
 </Form>}
 {test&&<><p>{test.scope}</p><Table heads={['Prior-year month','Would recognize','Actually recorded','Difference']} figures={[1,2,3]}>{test.months.map((m:D)=><tr key={m.month}><td>{m.month}</td><td>{usd(m.proposed)}</td><td>{usd(m.actual)}</td><td>{usd(m.difference)}</td></tr>)}</Table><details><summary>Back-test source entries</summary><ul>{test.proposed.map((r:D,i:number)=><li key={i}>{r.date} · {usd(r.amount)} · <a href={'/app/search?type=journal&record='+r.sourceJournalId}>Funding source</a></li>)}{test.actual.map((r:D)=><li key={r.id}>{r.date} · {usd(r.amount)} · <a href={'/app/search?type=journal&record='+r.id}>Actual recognition</a></li>)}</ul></details></>}
 {can&&state.actor.can.post&&p.status==='proposed'&&review&&<Form label="Approve this vendor and materiality" submit={b=>command('learned.approve',{...b,...review,id:p.id,revision:p.revision,backtest:JSON.stringify(review.test)})} onDone={async()=>{setReview(null);await onDone()}}>
 <Field label="Approved vendor" name="vendorId" options={[{value:p.vendor_id,label:p.vendor}]} defaultValue={p.vendor_id} required/>
 <Field label="Maximum funding amount" name="maxAmount" defaultValue={money(Math.max(...p.evidence.map((e:D)=>e.amount)))} required inputMode="decimal"/>
 </Form>}
 {can&&p.status==='approved'&&<><p>Approved only for {p.vendor}, up to {usd(p.max_cents)} per funding source. Preparing a plan does not approve its postings.</p>
 <Form label="Prepare source-funded plan" submit={b=>command('learned.prepare',{...b,id:p.id,revision:p.revision})} onDone={onDone}>
 <Field label="Reviewed funding source" name="sourceJournalId" options={p.sources.filter((s:D)=>!p.applications.some((a:D)=>a.source_journal_id===s.id)).map((s:D)=>({value:s.id,label:`${s.date} · ${usd(s.amount)}`}))} required/>
 </Form><Form label="Revoke this recommendation" submit={()=>command('learned.revoke',{id:p.id,revision:p.revision})} onDone={onDone} children={null}/></>}
 {p.applications.length>0&&<Table heads={['Prepared plan','Status','Posting approval']}>
 {p.applications.map((a:D)=><tr key={a.schedule_id}><td><a href={'/app/close?recognition='+a.schedule_id+'#recognition'}>Review source-funded plan</a></td><td>{a.status}</td><td>{a.approved_revision===a.revision?'Approved exact revision':'Human posting approval required'}</td></tr>)}
 </Table>}
 </section>
}
