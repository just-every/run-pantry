import { Help } from './help'
import { Card,Field,Form,Table,command,day,usd,useShared,useView,type D } from './kit'
export function AgentPermissions(){const {state}=useShared();return state.actor.can.owner?<OwnerPermissions/>:null}
function OwnerPermissions(){
 const {state}=useShared(),{data,reload}=useView<D>('agent-permissions')
 if(!data)return null
 return <Card title="Books-agent permissions"><p>Grant automatic filing only for one reviewed rule revision, one bank, an exact payee and an amount ceiling. Other work stays in review.</p>
 <Form label="Grant this standing permission" submit={b=>command('agent-permission.grant',{...b,ruleRevision:data.rules.find((r:D)=>r.id===b.ruleId)?.revision,confirm:b.confirm==='on'})} onDone={reload}>
 <Field label="Permission name" name="name" required/><Field label="Reviewed suggest-only rule" name="ruleId" options={data.rules.map((r:D)=>({value:r.id,label:r.name}))} required/>
 <Field label="Permission bank account" name="bankAccountId" options={state.bankAccounts.map((b:D)=>({value:b.id,label:b.name}))} required/>
 <Field label="Exact bank payee text" name="payee" required hint="Use the bank’s complete payee or description. Case and punctuation are normalized; partial names do not authorize a line."/>
 <Field label="Maximum automatic amount" name="maxAmount" required inputMode="decimal"/>
 <label><input name="confirm" type="checkbox" required/> I authorize these automatic postings within this exact scope.</label>
 </Form>
 <Form label="Run permitted work now" submit={()=>command('agent-permission.run',{})} onDone={reload} children={null}/>
 <Help label="How reviews are sampled"><p>{data.sampleMethod} Week beginning {data.week}.</p></Help>
 {data.permissions.map((p:D)=><section key={p.id} className="stack"><h3>{p.name}</h3><p>{p.active?'Active':'Revoked'} · {p.payee} · up to {usd(p.max_cents)}. Rule edits require a new permission.</p>
 <p>{p.metrics.actions} actions · {p.metrics.undone} undone · {p.metrics.reviewed} reviewed. Review accuracy: {p.metrics.accuracy===null?'No reviewed sample yet':`${p.metrics.correct}/${p.metrics.reviewed} correct (${Math.round(p.metrics.accuracy*100)}%)`}.</p>
 {p.active===1&&<Form label={'Revoke '+p.name} submit={()=>command('agent-permission.revoke',{id:p.id,revision:p.revision})} onDone={reload} children={null}/>}
 <Table heads={['Action date','Bank line','Amount','State','Human sample review']} figures={[2]} empty="No actions in this week’s sample.">{p.sample.map((a:D)=><tr key={a.id}><td>{day(a.at)}</td><td>{a.description}</td><td>{usd(a.amount_cents)}</td><td>{a.status}</td><td>{a.review??<><Form label="Correct" submit={()=>command('agent-action.review',{id:a.id,review:'correct'})} onDone={reload} children={null}/><Form label="Needs correction" submit={()=>command('agent-action.review',{id:a.id,review:'changed'})} onDone={reload} children={null}/></>}{a.status==='approved'&&<Form label="Undo sampled action" submit={()=>command('bank-rule.undo',{matchId:a.match_id,reason:'Owner reviewed books-agent sample'})} onDone={reload} children={null}/>}</td></tr>)}</Table>
 </section>)}
 </Card>
}
