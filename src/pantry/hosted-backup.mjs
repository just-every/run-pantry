import { createPortability } from '@runeditrun/rer/modules/portability'
import { checkedDocumentArchive } from './document-archive.mjs'
import { drainDocumentObjects } from './document-objects.mjs'
import policy from './archive-policy.mjs'

// Stream bounded multipart pieces; an archive can exceed the Worker's memory.
// Publication happens only after every piece succeeds. Failed uploads abort.
async function storeArchive(bucket, key, source) {
  const upload = await bucket.createMultipartUpload(key, {httpMetadata:{contentType:'application/x-ndjson'}})
  const reader = source.getReader(), parts = []
  let buffer = new Uint8Array(8 * 1024 * 1024), used = 0
  try {
    for (;;) {
      const {done,value} = await reader.read()
      if (done) break
      for (let offset=0; offset<value.length;) {
        const size = Math.min(buffer.length-used,value.length-offset)
        buffer.set(value.subarray(offset,offset+size),used); used+=size; offset+=size
        if (used===buffer.length) {
          parts.push(await upload.uploadPart(parts.length+1,buffer))
          buffer=new Uint8Array(buffer.length); used=0
        }
      }
    }
    if (used) parts.push(await upload.uploadPart(parts.length+1,buffer.subarray(0,used)))
    await upload.complete(parts)
  } catch (error) { await upload.abort(); throw error }
  finally { await reader.cancel(); reader.releaseLock() }
}

/** A private R2 binding opts a hosted installation into daily complete archives.
 * Each half-hour tick advances a bounded portion of the durable D1 snapshot.
 * The archive contains ledger and document bytes under the ordinary erasure
 * fence and credential exclusions. No automatic retention deletion is done.
 */
export async function runHostedBackup(env, scheduledTime) {
  if (!env.PANTRY_BACKUPS) return
  if (await drainDocumentObjects(env.DB,env.PANTRY_DOCUMENTS)) return
  const db=env.DB, today=new Date(scheduledTime).toISOString().slice(0,10)
  const lease=crypto.randomUUID(), stamp=Date.now()
  await db.prepare('INSERT OR IGNORE INTO pt_hosted_backup_runs(day) VALUES(?)').bind(today).run()
  const pending=await db.prepare("SELECT day FROM pt_hosted_backup_runs WHERE status<>'complete' ORDER BY day LIMIT 1").first()
  if (!pending) return
  const day=pending.day
  const claim=await db.prepare("UPDATE pt_hosted_backup_runs SET lease_id=?,lease_until=? WHERE day=? AND status<>'complete' AND lease_until<? RETURNING *").bind(lease,stamp+10*60_000,day,stamp).first()
  if (!claim) return
  let job=claim.job_id, service
  try {
    service=await createPortability({db,policy,buckets:{PANTRY_DOCUMENTS:env.PANTRY_DOCUMENTS}})
    // Erasure deletes transfer jobs, so a saved id may no longer be resumable.
    if (job) {
      const saved=await db.prepare('SELECT phase FROM rer_portability_jobs WHERE id=?').bind(job).first()
      if (!saved || !['building','complete'].includes(saved.phase)) job=null
    }
    // Recover a crash between snapshot creation and saving its id.
    if (!job) job=(await db.prepare("SELECT id FROM rer_portability_jobs WHERE actor=? AND kind='export' AND phase IN ('building','complete') ORDER BY rowid DESC LIMIT 1").bind('pantry:backup:'+day).first())?.id
    if (!job) job=await service.exports.create('pantry:backup:'+day)
    await db.prepare("UPDATE pt_hosted_backup_runs SET job_id=?,status='building',error_code=NULL WHERE day=? AND lease_id=?").bind(job,day,lease).run()
    const status=await service.exports.advance(job,{maxParts:32})
    if (status.phase==='complete') {
      const key='archives/'+day+'-'+job+'.rer'
      await storeArchive(env.PANTRY_BACKUPS,key,await checkedDocumentArchive(db,service,job))
      await db.prepare("UPDATE pt_hosted_backup_runs SET status='complete',object_key=?,content_hash=?,completed_at=? WHERE day=? AND lease_id=?").bind(key,status.contentHash,new Date(scheduledTime).toISOString(),day,lease).run()
      await service.exports.abort(job)
    }
  } catch (error) {
    // Erasure invalidates in-progress snapshots. Retrying starts a new snapshot,
    // while a provider failure can retry the same immutable completed archive.
    if (job && service && /document_(storage_pending|archive_integrity|archive_invalidated)/.test(error.message ?? '')) {
      const exists=await db.prepare('SELECT id FROM rer_portability_jobs WHERE id=?').bind(job).first()
      if (exists) await service.exports.abort(job)
    }
    const saved=job && await db.prepare('SELECT phase FROM rer_portability_jobs WHERE id=?').bind(job).first()
    const resumable=saved && ['building','complete'].includes(saved.phase)
    await db.prepare("UPDATE pt_hosted_backup_runs SET job_id=?,status=?,error_code='backup_failed' WHERE day=? AND lease_id=?").bind(resumable?job:null,resumable?'building':'pending',day,lease).run()
    throw new Error('Hosted backup failed; inspect the installation backup receipt and retry the next scheduled tick')
  } finally {
    await db.prepare('UPDATE pt_hosted_backup_runs SET lease_id=NULL,lease_until=0 WHERE day=? AND lease_id=?').bind(day,lease).run()
  }
}
