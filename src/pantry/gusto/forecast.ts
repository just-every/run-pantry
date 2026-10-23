import type { Bindings } from '../../auth.server'
import { availability, gusto } from './client'
import { accessToken, gustoSettings } from './payrolls'
import { payrollEntry } from './entry'

export async function upcomingPayroll(env:Bindings,db:D1Database,from:string,to:string) {
 const items:{id:string;date:string;amount:number}[]=[],warnings:string[]=[]
 const connection=await gustoSettings(db),available=availability(env)
 if(!connection?.company_uuid||!available.available)return {items,warnings:['Payroll forecast unavailable: connect Gusto with a provider schedule and calculated debit totals. No payroll amount has been invented.']}
 try{
  const token=await accessToken(env,db,connection),client=gusto(env),seen=new Set<string>()
  for(let page=1;page<=20;page++){
   const rows=await client.upcomingPayrolls(token,connection.company_uuid,from,to,page)
   for(const p of rows){const id=p.payroll_uuid??p.uuid;if(!id||seen.has(id)||p.processed||p.external||p.check_date<from||p.check_date>to)continue;seen.add(id)
    if(!p.totals){warnings.push(`Payroll ${p.check_date} has no calculated totals; excluded from the forecast`);continue}
    try{const calculated=payrollEntry(p.totals);if(!calculated.ok){warnings.push(`Payroll ${p.check_date} cannot be tied to provider totals; excluded`);continue}items.push({id,date:p.check_date,amount:calculated.debit})}catch{warnings.push(`Payroll ${p.check_date} has incomplete totals; excluded`)}
   }
   if(rows.length<100)break
   if(page===20)warnings.push('Payroll schedule exceeded 2,000 records; forecast is incomplete')
  }
 }catch{warnings.push('Gusto schedule could not be read. Payroll forecast is incomplete; reconnect or retry from Connections.')}
 return {items,warnings}
}
