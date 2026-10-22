import { type Data, requireThat } from './core'
import { reportPdf } from './report-pdf'
import { xlsxResponse, type SpreadsheetCell } from './xlsx'

const moneyKeys=new Set(['debit','credit','net','debitBalance','creditBalance','opening','closing','running','debit_cents','credit_cents','amount_cents','total_cents','tax_cents','open_cents','amount','totalIncome','totalExpenses','netIncome','totalAssets','totalLiabilities','totalEquity','totalOperating','totalInvesting','totalFinancing','netChange','itemsTotal','unapplied','subledger','balance','open','original','total','difference','book','cleared','outstanding'])
type Cell={path:string;value:SpreadsheetCell;unit:string;basis:string;from:string;to:string}
/** Flatten the entire retained package, including nonfinancial evidence, without
 * dropping fields. Every scalar retains its path, unit, basis and own range. */
export function accountantCells(pkg:Data){
 const rows:Cell[]=[]
 const visit=(value:unknown,path:string,context:{basis:string;from:string;to:string})=>{
  if(value&&typeof value==='object'&&!Array.isArray(value)){
   const v=value as Data,scope={basis:typeof v.basis==='string'?v.basis:context.basis,from:v.from??v.asOf??context.from,to:v.to??v.asOf??context.to}
   if(path==='cashFlow')scope.basis='Indirect method - accrual starting income'
   if(path==='receivables'||path==='payables')scope.basis='Open items - accrual basis'
   if(!path||['entity','period','close','stripeClearing','reconciliations','voidedReconciliations','reversals','approvals','audit','notes','documents','receipts','cutovers'].includes(path))scope.basis=path?'Whole-business evidence':context.basis
   if(!Object.keys(v).length)rows.push({path,value:'{}',unit:'text',...scope})
   for(const [key,child]of Object.entries(v))visit(child,path?path+'.'+key:key,scope)
  }else if(Array.isArray(value)){
   if(!value.length)rows.push({path,value:'[]',unit:'text',...context})
   value.forEach((child,i)=>visit(child,`${path}[${i}]`,context))
  }else{
   const key=path.split('.').at(-1)??'',money=typeof value==='number'&&(moneyKeys.has(key)||key.endsWith('_cents')||/^(receivables|payables)\.totals\[\d+\]$/.test(path))
   rows.push({path,value:money?Number(value)/100:value===null?'null':typeof value==='boolean'?String(value):value===undefined?'undefined':typeof value==='number'?value:String(value),unit:money?'USD':typeof value==='number'?'number':'text',...context})
  }
 }
 visit(pkg,'',{basis:pkg.basis,from:pkg.period.start,to:pkg.period.end});return rows
}
export function accountantExport(pkg:Data,format:string){
 const cells=accountantCells(pkg),name=`pantry-close-${pkg.period.id}`,rows:SpreadsheetCell[][]=[['Field / source path','Value','Unit','Basis / scope','From','To'],...cells.map(c=>[c.path,c.value,c.unit,c.basis,c.from,c.to])]
 const headers={'cache-control':'no-store','x-pantry-basis':pkg.basis,'content-disposition':`attachment; filename="${name}.${format}"`}
 if(format==='xlsx')return xlsxResponse(rows,name,{'x-pantry-basis':pkg.basis})
 if(format==='csv'){
  const csv=rows.map(row=>row.map(v=>'"'+String(typeof v==='string'&&/^[\s]*[=+\-@]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n'
  return new Response(csv,{headers:{...headers,'content-type':'text/csv; charset=utf-8'}})
 }
 requireThat(format==='pdf','Export format is pdf, csv or xlsx')
 return new Response(reportPdf({business:pkg.entity.legalName,title:`Accountant close package · ${pkg.period.id}`,basis:pkg.basis,range:`${pkg.period.start} to ${pkg.period.end}`,rows:[],notes:cells.map(c=>`${c.path}: ${c.unit==='USD'?Number(c.value).toFixed(2):String(c.value)} [${c.unit}; ${c.basis}; ${c.from} to ${c.to}]`)}),{headers:{...headers,'content-type':'application/pdf'}})
}
