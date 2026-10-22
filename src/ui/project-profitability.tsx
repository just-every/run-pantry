import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Field, Loading, Metrics, Table, day, usd, useShared, useView, type D } from './kit'

export function ProjectProfitability({from,to,basis}:{from:string;to:string;basis:'cash'|'accrual'}) {
 const {state}=useShared(),search=useSearch({from:'/app/reports'}),navigate=useNavigate({from:'/app/reports'})
 const projects=state.dimensions?.values.filter((v:D)=>v.kind==='project')??[]
 const name=projects.some((p:D)=>p.name===search.projectName)?search.projectName:projects[0]?.name
 const {data:r,error}=useView<D>(name?`dimensions/project?${new URLSearchParams({name,from,to,basis})}`:null)
 const figure=(line:string,value:number)=><Link to="/app/reports" search={{report:'profit-and-loss',from,to,basis,columns:'project',column:'value:'+name,line}}>{usd(value)}</Link>
 if(!projects.length)return <p>Add a project in Settings to see its profitability.</p>
 return <>
  <Field label="Project" name="projectName" value={name??''} options={projects.map((p:D)=>({value:p.name,label:p.name+(p.active?'':' (inactive)')}))} onChange={(e:React.ChangeEvent<HTMLSelectElement>)=>navigate({search:s=>({...s,projectName:e.target.value})})} />
  {!r?<Loading error={error} what="project profitability" />:<>
   <Metrics items={[{label:'Income',value:figure('income',r.income)},{label:'Costs',value:figure('expenses',r.costs)},{label:'Profit',value:figure('net-income',r.profit)},{label:'Billable time',value:`${(r.minutes/60).toFixed(2)} hours`},{label:'Unbilled time',value:`${(r.unbilledMinutes/60).toFixed(2)} hours`,note:usd(r.unbilledCents)+' at current service rates'}]} />
   <p className="hint">Income, costs and profit use posted project coding on the selected basis and date range. Time uses the native time project with the same name; unbilled value uses its current service rates.</p>
   <Table heads={['Date','Customer','Service','Hours','Status','Unbilled value']} figures={[3,5]} empty="No billable time in this project and range.">
    {r.time.map((t:D)=><tr key={t.id}><td>{day(t.work_date)}</td><td>{t.customer}</td><td>{t.service}</td><td className="fig">{(t.minutes/60).toFixed(2)}</td><td>{t.invoiced?'Invoiced':'Unbilled'}</td><td className="fig">{usd(t.invoiced?0:Math.round(t.rate_cents*t.minutes/60))}</td></tr>)}
   </Table><Link to="/app/time">Open billable time</Link>
  </>}
 </>
}
