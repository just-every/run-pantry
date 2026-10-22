import { inDimension,type DimensionScope } from './scope'
import { requireThat, type Data } from '../core'
import { all, one } from '../db'
import { generalLedger, profitAndLoss } from '../reports'
import type { Basis } from '../basis'
import { statementSnapshot, statementMatrix, type StatementColumns } from '../statement-columns'
import { DIMENSIONS, dimensionsView, type DimensionKind } from './index'

/** Each dimension column uses the same statement calculation as its unsplit total,
 * including balance-sheet openings and calculated fiscal-year earnings. */
export async function dimensionColumns(db:D1Database,kind:DimensionKind,from:string,to:string,basis:Basis,report:'profit-and-loss'|'balance-sheet'='profit-and-loss',startMonth=1):Promise<StatementColumns> {
 const settings=(await dimensionsView(db)).settings!,flag={class:'classes_enabled',location:'locations_enabled',project:'projects_enabled'}[kind]
 requireThat(settings[flag],'Enable this dimension before running its columns',409)
 const catalogue=await all(db,'SELECT name FROM pt_dimensions WHERE kind=? ORDER BY name',kind)
 const historical=await all(db,`SELECT DISTINCT l.${kind}_name AS name FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id WHERE e.status='posted' AND e.entry_date<=? AND l.${kind}_name<>''`,to)
 const names=[...new Set([...catalogue,...historical].map(v=>String(v.name)))].sort((a,b)=>a.localeCompare(b))
 // Include Unassigned even when empty; inactive catalogue values remain historical evidence.
 names.push('')
 const columns=[...names.map(name=>({id:name?'value:'+name:'unassigned',label:name||'Unassigned',from,to,unit:'money' as const})),{id:'total',label:'Total',from,to,unit:'money' as const}]
 const snapshots=[]
 for(const name of names) snapshots.push(await statementSnapshot(db,report,from,to,startMonth,basis,{kind,value:name,id:name?'value:'+name:'unassigned',label:`${kind} · ${name||'Unassigned'}`}))
 snapshots.push(await statementSnapshot(db,report,from,to,startMonth,basis))
 const rows=statementMatrix(snapshots,'rows'),totals=statementMatrix(snapshots,'totals')
 for(const row of [...rows,...totals]) requireThat(row.values.slice(0,-1).reduce<number>((sum,n)=>sum+(n??0),0)===row.values.at(-1),'Dimension columns do not tie to the unsplit statement',409)
 return {kind:report,mode:kind,basis,from,to,columns,rows,totals}
}
export async function projectProfit(db:D1Database,name:string,from:string,to:string,basis:Basis,scope?:DimensionScope){
 const project=await one(db,"SELECT name FROM pt_dimensions WHERE kind='project' AND name=? COLLATE NOCASE",name)
 requireThat(project,'Project not found',404);name=project.name
 const r=await dimensionColumns(db,'project',from,to,basis),i=r.columns.findIndex(c=>c.label===name)
 const values:Record<string,number>=Object.fromEntries(r.totals.map(t=>[t.id,i<0?0:t.values[i]??0]))
 const ledger=scope?await generalLedger(db,from,to,undefined,basis,scope):null
 if(ledger){values.income=ledger.accounts.filter(a=>a.type==='income').flatMap(a=>a.rows).filter((l:Data)=>l.project_name===name).reduce((n:number,l:Data)=>n+l.credit_cents-l.debit_cents,0);values.expenses=ledger.accounts.filter(a=>a.type==='expense').flatMap(a=>a.rows).filter((l:Data)=>l.project_name===name).reduce((n:number,l:Data)=>n+l.debit_cents-l.credit_cents,0);values['net-income']=values.income-values.expenses}
 const timeRows=await all(db,'SELECT t.id,t.work_date,t.minutes,t.invoice_id IS NOT NULL AS invoiced,c.name AS customer,p.name AS project,i.name AS service,CASE WHEN t.invoice_id IS NULL THEN i.rate_cents ELSE 0 END AS rate_cents FROM pt_time_entries t JOIN pt_time_projects p ON p.id=t.project_id JOIN pt_items i ON i.id=t.item_id JOIN pt_contacts c ON c.id=t.customer_id WHERE p.name=? AND t.work_date BETWEEN ? AND ? ORDER BY t.work_date,t.id',name,from,to)
 const time=timeRows.filter(()=>!scope||scope.kind==='project'? !scope||scope.value===name:scope.value==='')
 return {...(scope?{dimension:scope}:{}),name,basis,from,to,income:values.income,costs:values.expenses,profit:values['net-income'],minutes:time.reduce((s,t)=>s+t.minutes,0),unbilledMinutes:time.filter(t=>!t.invoiced).reduce((s,t)=>s+t.minutes,0),unbilledCents:time.filter(t=>!t.invoiced).reduce((s,t)=>s+Math.round(t.rate_cents*t.minutes/60),0),time,statement:r}
}
