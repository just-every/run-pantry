import { requireThat, type Data } from '../core'
import { reportSourceRows } from '../report-sources'
import type { Basis } from '../basis'
import { adjustingEntries } from '../year-end'
import { figureResult,parseLine } from '../report-figures/result'
import { projectProfit } from './report'
import { inDimension,type DimensionScope } from './scope'

export async function projectFigure(db:D1Database,name:string,line:string,from:string,to:string,basis:Basis,scope?:DimensionScope){
 requireThat(['income','costs','profit'].includes(line),'Choose a project profitability figure',404)
 const r=await projectProfit(db,name,from,to,basis,scope),types=line==='income'?['income']:line==='costs'?['expense']:['income','expense']
 const rows=(await reportSourceRows(db,{types,from,to,sign:line==='costs'?1:-1},basis)).filter(row=>row.project_name===r.name&&inDimension(row,scope))
 return figureResult({report:'project-profitability',line,label:`${r.name} · ${line}`,from,to,basis,figure:r[line as 'income'|'costs'|'profit'],rows,context:{projectName:r.name,...(scope?{dimension:scope.kind,dimensionValue:scope.id}:{})}})
}
export async function adjustingReport(db:D1Database,year:number,basis:Basis,scope?:DimensionScope){
 const r=await adjustingEntries(db,year,scope)
 return {...r,kind:'adjusting-entries',title:'Adjusting entries'+(scope?' · '+scope.label:''),from:r.start,to:r.end,basis,basisLabel:basis==='cash'?'Cash basis':'Accrual basis',note:'Posted adjusting journal lines within the fiscal year. Filtered sides may be coded elsewhere; readiness and the annual close remain whole-business checks.',columns:['Date','Entry','Account','Description','Debit','Credit'],moneyColumns:[4,5],rows:r.entries.flatMap(e=>e.lines.map((l:Data)=>({id:l.id,cells:[e.entry_date,String(e.number),`${l.code} · ${l.name}`,l.memo||e.memo,l.debit_cents,l.credit_cents],record:'entry:'+e.id}))),totals:[{label:'Debits',amount:r.debit},{label:'Credits',amount:r.credit}]}
}
export async function adjustingFigure(db:D1Database,year:number,line:string,basis:Basis,scope?:DimensionScope){
 const r=await adjustingReport(db,year,basis,scope),[id,metric]=parseLine(line,[2,2],'Choose an adjusting-entry figure')
 const i=Number(metric),isTotal=id==='total'
 requireThat(isTotal?[0,1].includes(i):[4,5].includes(i)&&r.rows.some(row=>row.id===id),'Choose an adjusting-entry figure',404)
 const sources=await reportSourceRows(db,{types:['asset','liability','equity','income','expense'],from:r.start,to:r.end,sign:1},basis)
 const keys=new Set(r.rows.map(row=>row.id)),debit=isTotal?i===0:i===4
 const rows=sources.filter(row=>keys.has(row.key)&&(isTotal||row.key===id)).map(row=>({...row,amount:debit?row.debit:row.credit}))
 const figure=isTotal?r.totals[i].amount:Number(r.rows.find(row=>row.id===id)!.cells[i])
 return figureResult({report:'adjusting-entries',line,label:debit?'Adjusting debits':'Adjusting credits',from:r.start,to:r.end,basis,figure,rows,context:{year,...(scope?{dimension:scope.kind,dimensionValue:scope.id}:{})}})
}
