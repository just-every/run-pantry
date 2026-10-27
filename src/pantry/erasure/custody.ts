// Import originals and before-images cannot become a second route to erased data.
import { retireD1ImportCustody } from '../../modules/import-kit/src/d1/index'
import { targetsFor } from '../cutover/target'
import { authorityCondition } from '../access'
import type { Context } from '../context'
import { all, batchStatements, faultFrom, run, type Sql } from '../db'

export async function runErasure(c:Context,statements:Sql[],subject:{id:string;member:boolean;values:string[]},checkpoint:Sql[]) {
  const jobs=await all(c.db,"SELECT id,namespace,operation_key,plan_json FROM ik_jobs WHERE destination='books'")
  if (!jobs.length) return run(c.db,[...statements,...checkpoint])
  const values=[...subject.values]
  // Member identity inside an immutable import withdraws that job's original
  // custody, including its undo/resume capability; native bookkeeping stays.
  if(subject.member) for(const job of jobs) if(subject.values.some(v=>String(job.plan_json??'').includes(v))) values.push(job.operation_key)
  try {
    return await retireD1ImportCustody({...(subject.member?{}:{target:{kind:'counterparty',id:subject.id}}),values},await batchStatements(c.db,statements),{
      destination:'books',namespace:jobs[0].namespace,mappingVersion:'erasure',storage:{database:c.db,targets:targetsFor('qbo')},
      authorization:{principalId:'pantry:move-in',predicate:()=>authorityCondition(c.actor,'owner')},batchSize:50,maxBatches:40,
    },checkpoint)
  } catch(error) {throw faultFrom(error)??error}
}
