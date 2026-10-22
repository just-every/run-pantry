import { BASIS_LABEL, type Basis } from './basis'
import { budgetReport } from './budgets/report'
import { contractors } from './contractors'
import { requireThat, type Data } from './core'
import { dimensionScope } from './dimensions/scope'
import { projectProfit } from './dimensions/report'
import { libraryExport } from './report-library/export'
import type { LibraryReport } from './report-library/types'

/** Dedicated report doors use the same calculated values as their screens. */
export async function dedicatedReport(db:D1Database,kind:string,query:Record<string,string>,basis:Basis):Promise<LibraryReport>{
 const {from,to,dimension,dimensionValue}=query,scope=await dimensionScope(db,dimension,dimensionValue)
 if(kind==='budget-actual'){
  requireThat(query.budget,'Choose a budget')
  const r=await budgetReport(db,query.budget,from,to,basis,{dimension,dimensionValue})
  return {kind,title:`Budget versus actual · ${r.name}${scope?' · '+scope.label:''}`,from,to,basis,basisLabel:BASIS_LABEL[basis],note:`Annual plan basis: ${BASIS_LABEL[r.budgetBasis as Basis]}. Variance is actual less budget; zero budget is not comparable.`,columns:['Account','Budget USD','Actual USD','Variance USD','Variance %'],moneyColumns:[1,2,3],rows:[...r.rows,{id:'net-income',name:'Net income',...r.netIncome}].map(r=>({id:r.id,cells:[r.name,r.budget,r.actual,r.variance,r.percent===null?'Not comparable':r.percent+'%']})),totals:[]}
 }
 if(kind==='contractors'){
  const year=Number(query.year??to.slice(0,4));requireThat(Number.isInteger(year)&&year>=2000&&year<=2100,'Choose a tax year')
  const r=await contractors(db,year,scope)
  return {kind,title:`1099 contractor review · ${year}${scope?' · '+scope.label:''}`,from:`${year}-01-01`,to:`${year}-12-31`,basis:'payment',basisLabel:'Payment basis',note:`${r.thresholdNote} Annual threshold decisions and forms use the whole year; selected dimensions affect payment contributions. TINs remain masked. This review is not an IRS filing.`,columns:['Contractor','Eligible USD','Excluded USD','Unknown method USD','Reversed USD','Annual threshold','TIN','Missing details'],moneyColumns:[1,2,3,4],rows:r.contractors.map(r=>({id:r.id,cells:[r.name,r.box1,r.excluded,r.unrecorded,r.reversed,r.overThreshold?'At or over threshold':r.mayReach?'May reach with unknown methods':'Below threshold',r.tax?.tin??'',r.missing.join(', ')]})),totals:[]}
 }
 requireThat(kind==='project-profitability','Choose a dedicated report',404)
 const r=await projectProfit(db,query.projectName??'',from,to,basis,scope)
 return {kind,title:`Project profitability · ${r.name}${scope?' · '+scope.label:''}`,from,to,basis,basisLabel:BASIS_LABEL[basis],note:`Billable time: ${(r.minutes/60).toFixed(2)} hours. Unbilled time: ${(r.unbilledMinutes/60).toFixed(2)} hours; current service-rate value USD ${(r.unbilledCents/100).toFixed(2)}. Time uses native project names; class/location time remains Unassigned.`,columns:['Figure','Amount USD'],moneyColumns:[1],rows:[['income','Income',r.income],['costs','Costs',r.costs],['profit','Profit',r.profit],['unbilled','Unbilled service-rate value',r.unbilledCents]].map(([id,name,amount])=>({id:String(id),cells:[String(name),Number(amount)]})),totals:[]}
}
export async function dedicatedExport(db:D1Database,kind:string,query:Record<string,string>,basis:Basis,format:string){return libraryExport(db,await dedicatedReport(db,kind,query,basis),format)}
