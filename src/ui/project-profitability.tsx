import { DimensionReportPicker } from './dimensions'
import { DimensionSplitPicker,DimensionSplits } from './dimension-splits'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Field, Loading, Metrics, Table, day, usd, useShared, useView, type D } from './kit'

export function ProjectProfitability({from,to,basis}:{from:string;to:string;basis:'cash'|'accrual'}) {
 const {state}=useShared(),search=useSearch({from:'/app/reports'}),navigate=useNavigate({from:'/app/reports'})
 const projects=state.dimensions?.values.filter((v:D)=>v.kind==='project')??[]
 const name=projects.some((p:D)=>p.name===search.projectName)?search.projectName:projects[0]?.name
 const {data:r,error}=useView<D>(name?`dimensions/project?${new URLSearchParams({name,from,to,basis,...(search.dimension?{dimension:search.dimension,dimensionValue:search.dimensionValue??''}:{})})}`:null)
 const figure=(line:string,value:number)=><Link to="/app/reports" search={{...search,report:'project-profitability',projectName:name,from,to,basis,line:line==='expenses'?'costs':line==='net-income'?'profit':line}}>{usd(value)}</Link>
 if(!projects.length)return <p>Add a project in Settings to see its profitability.</p>
 return <>
  <DimensionReportPicker /><DimensionSplitPicker />
  {name&&<p className="row-actions">{['pdf','csv','xlsx'].map(format=><a key={format} className="btn btn-secondary" download href={`/api/pantry/reports/project-profitability/export?${new URLSearchParams({projectName:name,from,to,basis,format,...(search.dimension?{dimension:search.dimension,dimensionValue:search.dimensionValue??''}:{})})}`}>Project {format==='xlsx'?'Excel':format.toUpperCase()} · {basis}</a>)}</p>}
  {search.split&&<DimensionSplits slug="project-profitability" from={from} to={to} basis={basis} path="dimensions/project/splits" extra={{name:name!}} />}
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
