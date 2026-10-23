import { useState } from 'react'
import { Card,Field,Form,PageHead,Table,command,day,usd,useView,useShared,Loading,type D } from './kit'
const money=(v:number)=>(v/100).toFixed(2)
export function Assets(){
 const {data,error,reload}=useView<D>('assets'),{state}=useShared(),owner=state.actor.role==='owner',accountant=owner||state.actor.role==='accountant',options=(type:string)=>state.accounts.filter((a:D)=>a.active&&a.type===type).map((a:D)=>({value:a.id,label:`${a.code} · ${a.name}`}))
 if(!data)return <Loading error={error} what="fixed assets"/>
 return <><PageHead title="Fixed assets" lead="Review capital purchases, approve book depreciation and keep tax elections separate."/>
 {owner&&<Card title="Capitalization policy"><Form label="Save capitalization policy" submit={b=>command('asset.settings',{...b,revision:data.settings.revision})} onDone={reload}>
 <Field label="Capitalize bill lines over" name="threshold" defaultValue={data.settings.threshold_cents==null?'':money(data.settings.threshold_cents)} required inputMode="decimal"/>
 <Field label="Election tax year" name="taxYear" type="number" defaultValue={data.settings.tax_year??new Date().getFullYear()} required/>
 <Field label="De minimis safe-harbor election record" name="safeHarbor" defaultValue={data.settings.safe_harbor} required hint="Record the accountant’s election or leave ‘Not elected’. Pantry makes no tax election for you."/>
 </Form></Card>}
 <Card title="Capitalization proposals"><p>Posted bill lines over the chosen threshold wait for a person. Nothing is capitalized automatically.</p>
 {!data.proposals.length&&<p>No eligible unregistered bill lines.</p>}
 {data.proposals.map((p:D)=><details key={p.id}><summary>{p.vendor} · {p.description} · {usd(p.amount_cents)}</summary><p><a href={'/app/search?type=bill&record='+p.bill_id}>Bill {p.reference}</a> · {day(p.bill_date)}</p>
 {owner&&state.actor.can.post?<Form label="Approve and capitalize this source line" submit={b=>command('asset.capitalize',{...b,billLineId:p.id,billRevision:p.bill_revision,cost:money(p.amount_cents),confirm:true})} onDone={reload}>
 <Field label="Asset name" name="name" defaultValue={p.description} required/><Field label="Placed in service" name="placedDate" type="date" defaultValue={p.bill_date} min={p.bill_date} required/>
 <Field label="Book life in months" name="months" type="number" defaultValue="12" min="1" max="1200" required/><Field label="Residual value" name="residual" defaultValue="0.00" required inputMode="decimal"/>
 <Field label="Book method" name="method" defaultValue="straight-line" options={[{value:'straight-line',label:'Straight line'},{value:'declining-balance',label:'Double declining balance'}]} required/>
 <Field label="Fixed asset account" name="assetAccountId" options={options('asset').filter((o:D)=>state.accounts.find((a:D)=>a.id===o.value)?.subtype==='other')} required/>
 <Field label="Accumulated depreciation account" name="accumulatedAccountId" options={options('asset').filter((o:D)=>state.accounts.find((a:D)=>a.id===o.value)?.subtype==='other')} required/>
 <Field label="Depreciation expense account" name="expenseAccountId" options={options('expense')} required/>
 </Form>:<p>The owner approves capitalization of this exact source cost.</p>}</details>)}
 </Card>
 {data.assets.map((a:D)=><Card key={a.id} title={a.name}>
 <p>{usd(a.cost_cents)} cost · {day(a.placed_date)} placed in service · {a.months} months · {a.method.replaceAll('-',' ')} · {a.disposed_date?'Disposed '+a.disposed_date:'In service'}</p>
 <p>{usd(a.depreciation.accumulated)} accumulated book depreciation · {usd(a.bookValue)} remaining book value.</p>
 <p><a href={'/app/search?type=bill&record='+a.bill_id}>Open source bill</a>{a.capitalization_journal_id&&<> · <a href={'/app/search?type=journal&record='+a.capitalization_journal_id}>Capitalization entry</a></>}{a.disposal_journal_id&&<> · <a href={'/app/search?type=journal&record='+a.disposal_journal_id}>Disposal entry</a></>}</p>
 {accountant&&!a.disposed_date&&<><Form label="Prepare next monthly journals" submit={()=>command('asset.prepare-depreciation',{id:a.id,revision:a.revision})} onDone={reload}><p>Prepare up to 24 months. Each journal needs ordinary exact-revision approval before it can run.</p></Form><Form label="Run approved depreciation due now" submit={()=>command('asset.run',{id:a.id})} onDone={reload} children={null}/></>}
 <Table heads={['Month','Book depreciation','Approval','Action']} figures={[1]} empty="No depreciation journals prepared yet.">{a.plan.map((p:D)=><tr key={p.occurrence}><td>{day(p.occurrence)}</td><td>{usd(p.amount_cents)}</td><td>{p.status}</td><td>{accountant&&state.actor.can.post&&p.status==='awaiting-approval'?<Form label={'Approve '+p.occurrence} submit={()=>command('recurring-journal.approve',{id:p.recurring_id,revision:p.revision})} onDone={reload} children={null}/>:<a href="/app/close">Review journals</a>}</td></tr>)}</Table>
 {a.depreciation.rows.length>0&&<details><summary>Posted book entries</summary><ul>{a.depreciation.rows.map((j:D)=><li key={j.id}><a href={'/app/search?type=journal&record='+j.id}>{j.entry_date} · {usd(j.amount_cents)}</a>{j.reversed_by_id?' · Reversed':''}</li>)}</ul></details>}
 {accountant&&<AssetTax a={a} reload={reload}/>}
 {owner&&!a.disposed_date&&<details><summary>Dispose of this asset</summary><p>Current book value {usd(a.bookValue)}. The reviewed entry removes cost and accumulated depreciation, records proceeds, and posts the difference as gain or loss.</p><Form label="Approve and record disposal" submit={b=>command('asset.dispose',{...b,id:a.id,revision:a.revision,accumulatedCents:a.depreciation.accumulated,confirm:true})} onDone={reload}>
 <Field label="Disposal date" name="date" type="date" required/><Field label="Disposal proceeds" name="proceeds" defaultValue="0.00" required/>
 <Field label="Proceeds bank ledger account" name="bankAccountId" options={options('asset').filter((o:D)=>state.accounts.find((x:D)=>x.id===o.value)?.subtype==='bank')} required/>
 <Field label="Gain income account" name="gainAccountId" options={options('income')} required/><Field label="Loss expense account" name="lossAccountId" options={options('expense')} required/>
 </Form></details>}
 </Card>)}
 </>
}

function AssetTax({a,reload}:{a:D;reload:()=>Promise<void>}){
 const [rows,setRows]=useState(Math.max(1,a.tax?.schedule.length??0))
 return <details><summary>Accountant tax schedule</summary><p>Tax amounts are entered by the accountant and appear in the tax package. They never post to the books.</p><Form label="Record tax election" submit={b=>command('asset.tax-election',{...b,id:a.id,taxRevision:a.tax?.revision,schedule:Array.from({length:rows},(_,n)=>({year:b['year_'+n],amount:b['amount_'+n]})).filter(r=>r.year&&r.amount)})} onDone={reload}>
 <Field label="Tax election year" name="year" type="number" defaultValue={a.tax?.election_year??Number(a.placed_date.slice(0,4))} required/><Field label="Section 179 amount" name="section179" defaultValue={money(a.tax?.section179_cents??0)} required/><Field label="Bonus depreciation amount" name="bonus" defaultValue={money(a.tax?.bonus_cents??0)} required/>
 <Field label="Tax method" name="method" defaultValue={a.tax?.method??'none'} options={['none','MACRS','accountant-entered'].map(value=>({value,label:value}))} required/>
 <fieldset><legend>Annual amounts calculated by the accountant</legend>{Array.from({length:rows},(_,n)=><div key={n}><Field label={'Schedule year '+(n+1)} name={'year_'+n} type="number" defaultValue={a.tax?.schedule[n]?.year??''}/><Field label={'Annual tax depreciation '+(n+1)} name={'amount_'+n} inputMode="decimal" defaultValue={a.tax?.schedule[n]?money(a.tax.schedule[n].amount):''}/></div>)}<button className="btn btn-secondary" type="button" onClick={()=>setRows(n=>Math.min(100,n+1))}>Add tax year</button></fieldset>
 <Field label="Accountant election note" name="note" type="textarea" defaultValue={a.tax?.note??''} required/>
 </Form></details>
}
