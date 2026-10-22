import { Link,useSearch } from '@tanstack/react-router'
import { Loading,Table,usd,type D } from './kit'
export function AdjustingReport({report:r}:{report:D}){
 const search=useSearch({from:'/app/reports'})
 if(!r)return <Loading what="adjusting entries" />
 const figure=(id:string,index:number,value:number)=><Link className="figure-link" to="/app/reports" search={{...search,line:JSON.stringify([id,String(index)]),record:undefined}}>{usd(value)}</Link>
 return <><p className="hint">{r.note}</p><Table heads={r.columns} figures={r.moneyColumns} empty="No posted adjusting lines." caption={r.title}>{r.rows.map((row:D)=><tr key={row.id}>{row.cells.map((v:string|number,i:number)=><td key={i}>{r.moneyColumns.includes(i)?figure(row.id,i,Number(v)):v}</td>)}</tr>)}</Table><Table heads={['Total','Amount']} figures={[1]}>{r.totals.map((total:D,i:number)=><tr key={i}><td>{total.label}</td><td>{figure('total',i,total.amount)}</td></tr>)}</Table></>
}
