import { requireThat } from '../core'
import type { Basis } from '../basis'
import { budgetReport } from '../budgets/report'
import { reportSplits } from './splits'
export async function budgetSplits(db:D1Database,id:string,from:string,to:string,basis:Basis,dimension:string){
 requireThat(['class','location'].includes(dimension),'Budget splits use class or location')
 return reportSplits(db,'budget-actual',dimension,{from,to,basis},scope=>budgetReport(db,id,from,to,basis,{dimension:scope?.kind,dimensionValue:scope?.id}))
}
