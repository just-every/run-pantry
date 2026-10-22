// Dimension splits read the existing filtered calculators. They never allocate
// header totals or recalculate settlements, and retain each figure's public key.
import { requireThat, type Data } from '../core'
import { all } from '../db'
import { dimensionScope, type DimensionScope } from './scope'
import { DIMENSIONS, type DimensionKind } from './index'
import type { Basis } from '../basis'
import { isLibrary } from '../report-library/types'

export async function dimensionScopes(db: D1Database, kind: string): Promise<DimensionScope[]> {
 requireThat(DIMENSIONS.includes(kind as DimensionKind),'Split by class, location or project')
 await dimensionScope(db,kind,'unassigned')
 const values=await all(db,`SELECT name FROM pt_dimensions WHERE kind=? UNION SELECT ${kind}_name AS name FROM pt_journal_lines WHERE ${kind}_name<>'' UNION SELECT name FROM pt_audit_dimensions WHERE kind=? ORDER BY name`,kind,kind)
 return [...values.filter(v=>v.name).map(v=>({kind:kind as DimensionKind,value:String(v.name),id:'value:'+v.name,label:`${kind} · ${v.name}`})),{kind:kind as DimensionKind,value:'',id:'unassigned',label:`${kind} · Unassigned`}]
}
export type SplitFigure={id:string;label:string;amount:number;unit:'money'|'count';line?:string}
export function splitFigures(kind:string,r:Data):SplitFigure[]{
 const rows:SplitFigure[]=[]
 const add=(id:string,label:string,amount:number,line=id,unit:'money'|'count'='money')=>rows.push({id,label,amount,line,unit})
 const key=(...parts:string[])=>JSON.stringify(parts)
 if(kind==='project-profitability'){
  for(const id of ['income','costs','profit'])add(id,id,r[id])
 }else if(kind==='contractors'){
  for(const c of r.contractors)for(const metric of ['box1','excluded','unrecorded','reversed'])add(key(c.id,metric),`${c.name} · ${metric}`,c[metric])
 }else if(kind==='budget-actual'){
  for(const a of [...r.rows,{id:'net-income',name:'Net income',...r.netIncome}])for(const metric of ['budget','actual','variance'])add(key(a.id,metric),`${a.name} · ${metric}`,a[metric])
 }else if(isLibrary(kind)||kind==='adjusting-entries'){
  if(kind==='audit-log')for(const row of r.rows)add(row.id,row.cells.join(' · '),1,undefined,'count')
  else {
   for(const row of r.rows)for(const i of r.moneyColumns)add(key(row.id,String(i)),`${row.cells.filter((_:unknown,n:number)=>!r.moneyColumns.includes(n)).join(' · ')} · ${r.columns[i]}`,row.cells[i])
   for(const [i,t] of r.totals.entries())add(key('total',String(i)),t.label,t.amount)
  }
 }else if(kind==='trial-balance'){
  for(const a of r.rows){add(key(a.id,'debit'),`${a.code} · ${a.name} · Debit`,a.debitBalance);add(key(a.id,'credit'),`${a.code} · ${a.name} · Credit`,a.creditBalance)}
  add(key('total','debit'),'Total debits',r.debit);add(key('total','credit'),'Total credits',r.credit)
 }else if(kind==='general-ledger'){
  for(const a of r.accounts){add(key(a.id,'opening'),`${a.code} · ${a.name} · Opening`,a.opening);for(const l of a.rows)for(const metric of ['debit','credit'])add(key(a.id,metric,l.id),`${a.code} · ${l.entry_date} · ${l.entry_memo} · ${metric}`,metric==='running'?l.running:l[metric+'_cents']);add(key(a.id,'closing'),`${a.code} · ${a.name} · Closing`,a.closing)}
 }else if(['sales-by-customer','expenses-by-vendor','sales-by-item'].includes(kind)){
  for(const row of r.rows)add(row.id,row.name,row.amount);add('total','Total',r.total)
 }else if(kind==='cash-flow'){
  for(const l of [...r.operating,...r.investing,...r.financing])add(l.id,l.name,l.amount)
  for(const [id,field] of [['operating','totalOperating'],['investing','totalInvesting'],['financing','totalFinancing'],['net-change','netChange'],['opening','opening'],['closing','closing']])add(id,id,r[field])
 }else if(kind==='sales-tax'){
  for(const metric of ['taxable','charged','collected','owed'])add(key('total',metric),`Total ${metric}`,r.totals[metric])
  for(const a of r.ledger.accounts)for(const metric of ['opening','fromSales','other','closing','owed'])add(key('account',a.id,metric),`${a.code} · ${a.name} · ${metric}`,a[metric])
 }else if(['receivables','payables'].includes(kind)){
  for(const i of r.items)add(key('item',i.id),`${i.contact} · ${i.ref} · Open`,i.open)
  for(const [i,b] of r.buckets.entries())add(key('bucket',b),b,r.totals[i])
  for(const [id,field] of [['items','itemsTotal'],['unapplied','unapplied'],['subledger','subledger']])add(key(id),id,r[field])
  add(key('control'),'Control balance',r.control.balance)
 }
 return rows
}
export type SplitOptions={from:string;to:string;basis:Basis;account?:string;payee?:string}
export async function reportSplits(db:D1Database,kind:string,dimension:string,options:SplitOptions,read:(scope?:DimensionScope)=>Promise<Data>){
 const scopes=await dimensionScopes(db,dimension),whole=await read(),sections=[]
 for(const scope of scopes){const report=await read(scope);sections.push({scope,report,figures:splitFigures(kind,report)})}
 const figures=splitFigures(kind,whole),byId=new Map(figures.map(f=>[f.id,{...f,values:[] as number[],lines:[] as (string|undefined)[]}]))
 for(const section of sections)for(const f of section.figures)if(!byId.has(f.id))byId.set(f.id,{...f,amount:0,values:[],lines:[]})
 for(const [id,row]of byId)for(const section of sections){const f=section.figures.find(f=>f.id===id);row.values.push(f?.amount??0);row.lines.push(f?.line)}
 const basis=whole.basis??options.basis,basisLabel=whole.basisLabel??(kind==='cash-flow'?'Indirect method - accrual starting income':['receivables','payables'].includes(kind)?'Open items - accrual basis':basis==='payment'?'Payment basis':basis==='cash'?'Cash basis':'Accrual basis')
 return {kind,dimension,from:whole.from??options.from,to:whole.to??options.to,basis,basisLabel,sections,whole,rows:[...byId.values()],note:kind==='audit-log'?'Frozen event memberships; a multi-value event appears in each relevant section. Unassigned includes history without recorded coding. Counts are not additive.':'Each column is the complete filtered report. Signed contributions add to the whole; debit/credit sides, original document amounts, ratios, status and filing decisions are not allocated totals.'}
}

/** Same values and source selectors as the split screen, in the existing
 * PDF/CSV/XLSX table contract. Non-additive values stay explicitly labeled. */
export function splitLibrary(r:Awaited<ReturnType<typeof reportSplits>>){
 return {kind:r.kind,title:`${r.kind.replaceAll('-',' ')} · split by ${r.dimension}`,from:r.from,to:r.to,basis:r.basis,basisLabel:r.basisLabel,note:r.note,
  columns:['Figure / source key',...r.sections.map(s=>s.scope.value||'Unassigned'),'Whole business'],moneyColumns:r.kind==='audit-log'?[]:r.sections.map((_,i)=>i+1).concat(r.sections.length+1),
  rows:r.rows.map(row=>({id:row.id,cells:[`${row.label} · ${row.id}`,...row.values,row.amount]})),totals:[]}
}
