import type { Context } from './context'
import { authority, must, who, tinAuthority } from './access'
import { audit, one, run } from './db'
import { requireThat } from './core'
import { necRows, necCell } from './contractors'
import { reportPdf } from './report-pdf'
import { xlsxResponse } from './xlsx'
import { recordReportIssue } from './effects/issues'

/** Every filing format shares the same masked default and explicit disclosure gate. */
export async function contractorFormExport(ctx:Context,year:number,format:string,fullTin=false){
 const checks = fullTin ? await tinAuthority(ctx) : (must(ctx.actor,'post'), [authority(ctx.actor,'post')])
 requireThat(Number.isInteger(year)&&year>=2000&&year<=2100,'Choose a tax year')
 requireThat(['csv','pdf','xlsx'].includes(format),'Choose CSV, PDF or Excel')
 const rows=await necRows(ctx.db,year,fullTin?{env:ctx.env,checks}:undefined),entity=await one(ctx.db,'SELECT legal_name FROM pt_entity WHERE id=1')
 let response:Response
 if(format==='csv')response=new Response(rows.map(r=>r.map(necCell).join(',')).join('\r\n')+'\r\n',{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="pantry-1099-nec-${year}.csv"`,'cache-control':'no-store'}})
 else if(format==='xlsx')response=xlsxResponse([rows[0],...rows.slice(1).map(r=>r.map((v,i)=>i===12||i===13?Number(v):v))],`pantry-1099-nec-${year}`,{'x-pantry-basis':'Payment basis'})
 else response=new Response(reportPdf({business:entity?.legal_name??'Pantry',title:`1099-NEC filing data · ${year}`,basis:'Payment basis',range:`${year}-01-01 to ${year}-12-31`,rows:rows.slice(1).flatMap(r=>[{description:`${r[5]} · Box 1 nonemployee compensation`,amount:Math.round(Number(r[12])*100)},{description:`${r[5]} · Box 4 federal income tax withheld`,amount:Math.round(Number(r[13])*100)}]),notes:rows.slice(1).map(r=>r.map((v,i)=>`${rows[0][i]}: ${v}`).join(' · '))}),{headers:{'content-type':'application/pdf','content-disposition':`attachment; filename="pantry-1099-nec-${year}.pdf"`,'cache-control':'no-store','x-pantry-basis':'Payment basis'}})
 await run(ctx.db,[...checks,audit(who(ctx.actor),format==='csv'?'contractor.1099-csv':'contractor.1099-export','tax-year',String(year),{format,fullTin,forms:rows.length-1})])
 if(format==='csv')await recordReportIssue(ctx.db,who(ctx.actor),{kind:'report',name:`1099-NEC · ${year}`,from:`${year}-01-01`,to:`${year}-12-31`,basis:'cash',report:'contractors'})
 response.headers.set('cache-control','no-store')
 response.headers.set('x-pantry-tin',fullTin?'full':'masked')
 return response
}
