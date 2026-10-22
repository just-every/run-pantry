import type { Context } from './context'
import { authority, must, who } from './access'
import { audit, one, run } from './db'
import { requireThat } from './core'
import { necRows } from './contractors'
import { reportPdf } from './report-pdf'
import { xlsxResponse } from './xlsx'

/** Full tax identity uses exactly the audited posting authority of the filing CSV. */
export async function contractorFormExport(ctx:Context,year:number,format:string){
 must(ctx.actor,'post');requireThat(format==='pdf'||format==='xlsx','Choose PDF or Excel')
 const rows=await necRows(ctx.db,year),entity=await one(ctx.db,'SELECT legal_name FROM pt_entity WHERE id=1')
 let response:Response
 if(format==='xlsx')response=xlsxResponse([rows[0],...rows.slice(1).map(r=>r.map((v,i)=>i===12||i===13?Number(v):v))],`pantry-1099-nec-${year}`,{'x-pantry-basis':'Payment basis'})
 else response=new Response(reportPdf({business:entity?.legal_name??'Pantry',title:`1099-NEC filing data · ${year}`,basis:'Payment basis',range:`${year}-01-01 to ${year}-12-31`,rows:rows.slice(1).flatMap(r=>[{description:`${r[5]} · Box 1 nonemployee compensation`,amount:Math.round(Number(r[12])*100)},{description:`${r[5]} · Box 4 federal income tax withheld`,amount:Math.round(Number(r[13])*100)}]),notes:rows.slice(1).map(r=>r.map((v,i)=>`${rows[0][i]}: ${v}`).join(' · '))}),{headers:{'content-type':'application/pdf','content-disposition':`attachment; filename="pantry-1099-nec-${year}.pdf"`,'cache-control':'no-store','x-pantry-basis':'Payment basis'}})
 await run(ctx.db,[authority(ctx.actor,'post'),audit(who(ctx.actor),'contractor.1099-export','tax-year',String(year),{format,forms:rows.length-1})])
 return response
}
