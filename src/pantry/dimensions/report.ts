import { requireThat, type Data } from '../core'
import { all } from '../db'
import { generalLedger, profitAndLoss } from '../reports'
import type { Basis } from '../basis'
import type { StatementColumns } from '../statement-columns'
import { DIMENSIONS, dimensionsView, type DimensionKind } from './index'

export async function dimensionColumns(db:D1Database,kind:DimensionKind,from:string,to:string,basis:Basis):Promise<StatementColumns> {
 const settings=(await dimensionsView(db)).settings!,flag={class:'classes_enabled',location:'locations_enabled',project:'projects_enabled'}[kind]
 requireThat(settings[flag],'Enable this dimension before running its columns',409)
 const ledger=await generalLedger(db,from,to,undefined,basis),field=`${kind}_name`
 const accounts=ledger.accounts.filter(a=>['income','expense'].includes(a.type))
 const names=[...new Set(accounts.flatMap(a=>a.rows.map((l:Data)=>String(l[field]??''))))].sort((a,b)=>a.localeCompare(b))
 if(!names.includes(''))names.push('')
 const columns=[...names.map(name=>({id:name?'value:'+name:'unassigned',label:name||'Unassigned',from,to,unit:'money' as const})),{id:'total',label:'Total',from,to,unit:'money' as const}]
 const rows=accounts.map(a=>{const values=names.map(name=>a.rows.filter((l:Data)=>String(l[field]??'')===name).reduce((sum:number,l:Data)=>sum+(l.debit_cents-l.credit_cents)*(a.type==='income'?-1:1),0));return{id:a.id,code:a.code,name:a.name,section:a.type==='income'?'Income':'Expenses',values:[...values,values.reduce((s,n)=>s+n,0)]}})
 const sum=(section:string)=>columns.map((_,i)=>rows.filter(r=>r.section===section).reduce((s,r)=>s+r.values[i],0)),income=sum('Income'),expenses=sum('Expenses')
 const totals=[{id:'income',code:'',name:'Total income',section:'Income',values:income},{id:'expenses',code:'',name:'Total expenses',section:'Expenses',values:expenses},{id:'net-income',code:'',name:'Net income',section:'',values:income.map((n,i)=>n-expenses[i])}]
 const unsplit=await profitAndLoss(db,from,to,basis)
 requireThat(income.at(-1)===unsplit.totalIncome&&expenses.at(-1)===unsplit.totalExpenses,'Dimension columns do not tie to the unsplit statement',409)
 return {kind:'profit-and-loss',mode:kind,basis,from,to,columns,rows,totals}
}
export async function projectProfit(db:D1Database,name:string,from:string,to:string,basis:Basis){
 requireThat(await all(db,"SELECT id FROM pt_dimensions WHERE kind='project' AND name=? COLLATE NOCASE",name).then(r=>r.length),'Project not found',404)
 const r=await dimensionColumns(db,'project',from,to,basis),i=r.columns.findIndex(c=>c.label===name)
 const values=Object.fromEntries(r.totals.map(t=>[t.id,i<0?0:t.values[i]]))
 const time=await all(db,'SELECT t.id,t.work_date,t.minutes,t.invoice_id IS NOT NULL AS invoiced,c.name AS customer,p.name AS project,i.name AS service,CASE WHEN t.invoice_id IS NULL THEN i.rate_cents ELSE 0 END AS rate_cents FROM pt_time_entries t JOIN pt_time_projects p ON p.id=t.project_id JOIN pt_items i ON i.id=t.item_id JOIN pt_contacts c ON c.id=t.customer_id WHERE p.name=? AND t.work_date BETWEEN ? AND ? ORDER BY t.work_date,t.id',name,from,to)
 return {name,basis,from,to,income:values.income,costs:values.expenses,profit:values['net-income'],minutes:time.reduce((s,t)=>s+t.minutes,0),unbilledMinutes:time.filter(t=>!t.invoiced).reduce((s,t)=>s+t.minutes,0),unbilledCents:time.filter(t=>!t.invoiced).reduce((s,t)=>s+Math.round(t.rate_cents*t.minutes/60),0),time,statement:r}
}
