import type { Context } from '../context'
import { date, monthBounds, requireThat, type Data } from '../core'
import { one } from '../db'
import { reportBasis } from '../basis'
import { accountantPackage } from '../package'
import { accountantExport } from '../accountant-export'
import { nativeReportExport } from '../report-export-reader'
import { customReportsCsv, customReportsRows } from '../custom-reports/csv'
import { customReportPdf, managementReportPdf } from '../custom-reports/pdf'
import { exportReport, sharingNote } from '../custom-reports/routes'
import { assertReportRead, renderSavedPackage, renderSavedReport, savedReport } from '../custom-reports/store'
import { calculateCustomReport } from '../custom-reports/calculate'
import type { CustomReportDefinition } from '../custom-reports/types'
import type { ReportIssue } from '../effects/issues'
import { xlsxResponse } from '../xlsx'

type Selection={kind:string;id?:string;report?:string;query?:Record<string,string>;rangeMode?:'saved'|'occurrence'}
export async function buildDelivery(ctx:Context,selection:Selection,format:string){
 requireThat(['pdf','csv','xlsx'].includes(format),'Choose PDF, Excel or CSV')
 await assertReportRead(ctx)
 const q=selection.query??{},business=(await one(ctx.db,'SELECT legal_name FROM pt_entity WHERE id=1'))?.legal_name??'Pantry'
 let response:Response,issue:ReportIssue,name:string,actualBasis:string
 if(selection.kind==='report'){
  const result=await nativeReportExport(ctx.db,selection.report??'',q,format)
  response=result.response;issue=result.issue;name=result.name;actualBasis=result.basis
 }else if(selection.kind==='accountant-package'){
  const period=q.period??q.to?.slice(0,7);requireThat(period,'Choose a close period')
  const {start,end}=monthBounds(period),basis=await reportBasis(ctx.db,q.basis)
  const pkg=await accountantPackage(ctx.db,period,basis)
  response=accountantExport(pkg,format);name=`Accountant package · ${period}`;actualBasis=basis
  issue={kind:'accountant-package',name,from:start,to:end,basis}
 }else{
  requireThat(selection.kind==='custom-report'||selection.kind==='management-package','Choose a report or package')
  requireThat(selection.id,'Choose a saved report or package')
  const packaged=selection.kind==='management-package',rendered=packaged?await renderSavedPackage(ctx,selection.id):null
  const single=packaged?null:await renderSavedReport(ctx,selection.id)
  const reports=rendered?.reports??[single!],saved=rendered?.saved??single!.saved
  const definitions:CustomReportDefinition[]=[]
  const calculated=[]
  for(const original of reports){
   const definition:CustomReportDefinition={...original.saved.definition,...(selection.rangeMode==='occurrence'?{from:date(q.from),to:date(q.to)}:{})}
   const report=selection.rangeMode==='occurrence'?await calculateCustomReport(ctx.db,definition):original.report
   definitions.push({...definition,basis:report.basis});calculated.push({saved:original.saved,report})
  }
  const exported=calculated.map(exportReport),notes=packaged?[saved.cover,...saved.commentary,sharingNote(saved)].filter(Boolean):[]
  name=saved.name;actualBasis=exported[0].basis
  if(format==='csv')response=new Response(customReportsCsv(exported,packaged?name:'',notes),{headers:{'content-type':'text/csv; charset=utf-8'}})
  else if(format==='xlsx')response=xlsxResponse(customReportsRows(exported,packaged?name:'',notes),'pantry-scheduled-report')
  else response=new Response(packaged?managementReportPdf({business,title:name,cover:saved.cover,commentary:notes,reports:exported}):customReportPdf(exported[0],business),{headers:{'content-type':'application/pdf'}})
  for(const report of reports){const current=await savedReport(ctx,report.saved.id);requireThat(current.revision===report.saved.revision,'Report changed while preparing delivery',409)}
  const current=await savedReport(ctx,saved.id,packaged?'package':'report');requireThat(current.revision===saved.revision,'Package changed while preparing delivery',409)
  issue={kind:selection.kind,name,from:exported.map(r=>r.from).sort()[0],to:exported.map(r=>r.to).sort().at(-1)!,basis:exported[0].basis,...(packaged?{definitions}:{definition:definitions[0],report:definitions[0].source})}
 }
 await assertReportRead(ctx)
 const bytes=new Uint8Array(await response.arrayBuffer()),filename=`pantry-${selection.kind}-${issue.to}.${format}`
 return {bytes,filename,contentType:response.headers.get('content-type')??'application/octet-stream',name,issue,from:issue.from,to:issue.to,basis:actualBasis}
}
