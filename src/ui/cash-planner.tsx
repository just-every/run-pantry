import { useRouterState } from '@tanstack/react-router'
import { Card, Field, Form, PageHead, Table, day, usd, useView, Loading, type D } from './kit'
export function CashPlanner(){
 const search=useRouterState({select:s=>s.location.searchStr}),query=new URLSearchParams(search),{data,error}=useView<D>('cash-planner?'+query)
 const whatIf=(()=>{try{return JSON.parse(query.get('whatIf')??'[]')}catch{return []}})()
 return <><PageHead title="Cash planner" lead="Thirteen weeks, with the records and assumptions behind each balance." />
 <Card title="Projection dates"><form className="form" action="/app/cash-planner"><Field label="Projection starts" name="asOf" type="date" defaultValue={query.get('asOf')??new Date().toISOString().slice(0,10)} /><Field label="Alert below" name="threshold" defaultValue={query.get('threshold')??'0.00'} inputMode="decimal" /><button className="btn btn-primary">Update projection</button></form></Card>
 {!data?<Loading error={error} what="cash projection" />:<>
 {data.lowWeeks.length>0&&<div className="notice notice-warn" role="alert"><strong>Projected cash below {usd(data.threshold)}</strong><p>Weeks starting {data.lowWeeks.join(', ')}. Review the items and timing below before making a decision.</p></div>}
 {data.payrollWarnings.map((warning:string)=><p key={warning} className="notice">{warning}</p>)}
 <Card title={`Opening cash · ${usd(data.opening)}`}><Table heads={['Bank account','Source','Balance']} figures={[2]}>{data.banks.map((b:D)=><tr key={b.id}><td><a href={b.href}>{b.name}</a></td><td>{b.basis}</td><td>{usd(b.balance)}</td></tr>)}</Table></Card>
 <Card title="What if?"><p>Try a purchase or an extra receipt. Negative amounts reduce cash. These items never change the books.</p><Form label="Add what-if item" submit={async b=>{const q=new URLSearchParams(query);q.set('whatIf',JSON.stringify([...whatIf,b]));window.location.assign('/app/cash-planner?'+q);return {}}}>
 <Field label="Scenario item" name="label" required maxLength={100}/><Field label="Scenario date" name="date" type="date" required min={data.asOf} max={data.end} defaultValue={data.asOf}/><Field label="Scenario amount" name="amount" required inputMode="decimal" placeholder="-15000.00" />
 </Form>{whatIf.length>0&&<p><a href={'/app/cash-planner?'+new URLSearchParams({asOf:data.asOf,threshold:(data.threshold/100).toFixed(2)})}>Remove what-if items</a></p>}</Card>
 <Card title="13-week projection"><p>{data.method}</p><a download="cash-projection.json" href={'/api/pantry/cash-planner?'+query}>Export projection JSON</a>
 <Table heads={['Week starting','Opening','Items','Closing']} figures={[1,2,3]}>{data.weeks.map((w:D)=><tr key={w.start}><td><a href={'#week-'+w.start}>{day(w.start)}</a></td><td>{usd(w.opening)}</td><td>{usd(w.change)}</td><td>{usd(w.closing)}{w.low&&<small className="sub">Below alert threshold</small>}</td></tr>)}</Table></Card>
 {data.weeks.map((w:D)=><section key={w.start} id={'week-'+w.start}><Card title={`Week of ${w.start} · ${usd(w.closing)}`}><p>{usd(w.opening)} opening + {usd(w.change)} listed items = {usd(w.closing)} closing.</p><Table heads={['Expected date','Item','Why this date','Amount']} figures={[3]} empty="No expected movements this week.">{w.items.map((i:D)=><tr key={i.id}><td>{day(i.date)}</td><td>{i.href?<a href={i.href}>{i.label}</a>:i.label}</td><td>{i.reason}</td><td>{usd(i.amount)}</td></tr>)}</Table></Card></section>)}
 {data.expectations.map((e:D)=>e.history.length>0&&<Card key={e.invoiceId} title="Customer payment history"><p>{e.reason}</p><Table heads={['Invoice','Issued','Paid','Days']} figures={[3]}>{e.history.map((i:D)=><tr key={i.id}><td><a href={i.href}>Open paid invoice</a></td><td>{day(i.issued)}</td><td>{day(i.paid)}</td><td>{i.days}</td></tr>)}</Table></Card>)}
 </>}
 </>
}
