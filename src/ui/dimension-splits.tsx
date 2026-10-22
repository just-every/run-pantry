import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Field, Loading, Table, usd, useShared, useView, type D } from './kit'

export function DimensionSplitPicker({kinds=['class','location','project']}:{kinds?:string[]}){
 const {state}=useShared(),search=useSearch({from:'/app/reports'}),navigate=useNavigate({from:'/app/reports'})
 const flags:D={class:'classes_enabled',location:'locations_enabled',project:'projects_enabled'}
 return <Field label="Split by dimension" name="split" value={search.split??''} empty="No dimension split" options={kinds.filter(k=>state.dimensions?.settings[flags[k]]).map(value=>({value,label:value}))} onChange={(e:any)=>void navigate({search:{...search,split:e.target.value||undefined,dimension:undefined,dimensionValue:undefined,line:undefined,record:undefined}})} />
}
export function DimensionSplits({slug,from,to,basis,path,extra={}}:{slug:string;from:string;to:string;basis:'cash'|'accrual';path?:string;extra?:Record<string,string>}){
 const search=useSearch({from:'/app/reports'}),query=new URLSearchParams({from,to,basis,split:search.split??'',...extra,...(search.account?{account:search.account}:{}),...(search.payee?{payee:search.payee}:{}),...(search.year?{year:search.year}:{})})
 const {data:r,error}=useView<D>(`${path??`reports/${slug}/splits`}?${query}`)
 if(!r)return <Loading error={error} what="the dimension splits" />
 return <><p className="hint">{r.note}</p><p className="row-actions">{r.sections.map((section:D)=><Link key={section.scope.id} to="/app/reports" search={{...search,split:undefined,dimension:section.scope.kind,dimensionValue:section.scope.id,line:undefined,record:undefined}}>Open {section.scope.label}</Link>)}</p>
  <Table heads={['Figure',...r.sections.map((s:D)=>s.scope.value||'Unassigned'),'Whole business']} figures={r.sections.map((_:unknown,i:number)=>i+1).concat(r.sections.length+1)} empty="No activity in this range." caption={`Report split by ${r.dimension}`}>
   {r.rows.map((row:D)=><tr key={row.id}><td>{row.label}</td>{row.values.map((amount:number,i:number)=><td className="fig" key={i}>{row.lines[i]&&row.unit==='money'?<Link className="figure-link" to="/app/reports" search={{...search,split:undefined,dimension:r.dimension,dimensionValue:r.sections[i].scope.id,line:row.lines[i],record:undefined}}>{usd(amount)}</Link>:row.unit==='count'?amount:usd(amount)}</td>)}<td className="fig">{row.unit==='count'?row.amount:usd(row.amount)}</td></tr>)}
  </Table></>
}
