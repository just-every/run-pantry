import { now, uid } from '../core'
import { guard, one, q, type Sql } from '../db'

const AFFECTED=`e.record_id=? OR e.record_id IN (SELECT id FROM pt_invoices WHERE customer_id=?) OR e.record_id IN (SELECT id FROM pt_bills WHERE vendor_id=?) OR e.record_id IN (SELECT id FROM pt_payments WHERE contact_id=?) OR e.record_id IN (SELECT entry_id FROM pt_journal_lines WHERE contact_id=?) OR e.record_id IN (SELECT id FROM pt_vendor_credits WHERE vendor_id=?)`

export async function pendingErased(db:D1Database,id:string):Promise<number> {
  return Number((await one(db,`SELECT count(*) n FROM pt_webhook_deliveries d JOIN pt_webhook_events e ON e.id=d.event_id WHERE d.state IN ('pending','sending') AND (${AFFECTED})`,...Array(6).fill(id)))!.n)
}

/** Queued notices about an erased contact or its books lose consent atomically. */
export async function cancelErased(db:D1Database,id:string):Promise<{count:number;statements:Sql[]}> {
  const affected=AFFECTED
  const params=Array(6).fill(id)
  const source=`FROM pt_webhook_deliveries d JOIN pt_webhook_events e ON e.id=d.event_id WHERE d.state IN ('pending','sending') AND (${affected})`
  const count=await pendingErased(db,id)
  return {count,statements:[guard(`(SELECT count(*) ${source})=?`,...params,count),q(`INSERT INTO pt_webhook_attempts (id,delivery_id,event_id,type,kind,record_id,revision,status,host,attempt,at,outcome,status_code,error_class,duration_ms)
    SELECT ?||':'||d.id,d.id,e.id,e.type,e.kind,e.record_id,e.revision,e.status,d.host,d.attempt,?,'cancelled',NULL,'record_erased',0
    FROM pt_webhook_deliveries d JOIN pt_webhook_events e ON e.id=d.event_id WHERE d.state IN ('pending','sending') AND (${affected})`,uid(),now(),...params),
    q(`UPDATE pt_webhook_deliveries SET state='cancelled',lease_until=NULL WHERE state IN ('pending','sending') AND event_id IN (SELECT e.id FROM pt_webhook_events e WHERE ${affected})`,...params)]}
}
