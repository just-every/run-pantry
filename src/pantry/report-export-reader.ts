import { reportBasis, type Basis } from './basis'
import { date, requireThat } from './core'
import { dedicatedReport } from './dedicated-report-export'
import { dimensionScope } from './dimensions/scope'
import { adjustingReport } from './dimensions/special-reports'
import { splitLibrary, type reportSplits } from './dimensions/splits'
import type { ReportIssue } from './effects/issues'
import { isLibrary, libraryReport } from './report-library'
import { libraryExport } from './report-library/export'
import { reportExport } from './report-export'
import { readReport } from './report-reader'

export async function nativeReportExport(db:D1Database,kind:string,q:Record<string,string>,format:string){
 const to=date(q.to),from=date(q.from??to.slice(0,8)+'01'),basis=await reportBasis(db,q.basis)
 requireThat(from<=to,'From date must be on or before To date')
 requireThat(!q.dimensionValue||q.dimension,'Choose a dimension before a value')
 const options={from,to,basis,columns:q.columns,account:q.account,payee:q.payee,dimension:q.dimension,dimensionValue:q.dimensionValue}
 let response:Response,actualBasis:string=basis,actualFrom=from,actualTo=to
 if(['budget-actual','project-profitability','contractors'].includes(kind)){
  const report=await dedicatedReport(db,kind,{...q,from,to},basis)
  actualBasis=report.basis;actualFrom=report.from;actualTo=report.to
  response=await libraryExport(db,report,format)
 }else if(!['profit-and-loss','balance-sheet'].includes(kind)&&['class','location','project'].includes(q.columns)){
  const report=await readReport(db,kind,options) as Awaited<ReturnType<typeof reportSplits>>
  actualBasis=report.basis;actualFrom=report.from;actualTo=report.to
  response=await libraryExport(db,splitLibrary(report),format)
 }else if(kind==='adjusting-entries'||isLibrary(kind)){
  const scope=await dimensionScope(db,q.dimension,q.dimensionValue)
  const report=kind==='adjusting-entries'?await adjustingReport(db,Number(to.slice(0,4)),basis,scope):await libraryReport(db,kind,from,to,basis,q.account,q.payee,scope)
  actualBasis=report.basis;actualFrom=report.from;actualTo=report.to
  response=await libraryExport(db,report,format)
 }else{
  response=await reportExport(db,kind,from,to,basis,format,q.columns,q.account,q.dimension,q.dimensionValue)
  if(['cash-flow','receivables','payables'].includes(kind))actualBasis='accrual'
 }
 const financialBasis:Basis=actualBasis==='cash'?'cash':actualBasis==='accrual'?'accrual':basis
 const issue:ReportIssue={kind:'report',name:kind.replaceAll('-',' '),from:actualFrom,to:actualTo,basis:financialBasis,report:kind,dimension:q.dimension,dimensionValue:q.dimensionValue,account:q.account,payee:q.payee,columns:q.columns,...(kind==='budget-actual'?{budgetId:q.budget}: {}),...(kind==='project-profitability'?{projectName:q.projectName}: {})}
 return {response,issue,name:issue.name,from:actualFrom,to:actualTo,basis:actualBasis}
}
