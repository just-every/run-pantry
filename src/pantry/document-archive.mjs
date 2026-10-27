/** Check the completed snapshot's document hashes before publishing any bytes.
 * SQL dump exports can otherwise pair an old ledger with newer R2 tombstones. */
export async function checkedDocumentArchive(db, service, id) {
  const job = await db.prepare('SELECT metadata FROM rer_portability_jobs WHERE id=?').bind(id).first()
  if (!job) throw new Error('document_archive_invalidated')
  const {manifest,copies} = JSON.parse(job.metadata)
  const quote = value => '"' + value.replaceAll('"','""') + '"'
  const objects = (await db.prepare(`SELECT * FROM ${quote(copies.pt_document_objects)}`).all()).results
  const documents = new Map((await db.prepare(`SELECT id,size,sha256,erased_at FROM ${quote(copies.pt_documents)}`).all()).results.map(d=>[d.id,d]))
  const inventory = new Map(manifest.objects.filter(o=>o.bucket==='PANTRY_DOCUMENTS').map(o=>[o.key,o]))
  for (const object of objects) {
    const stored=inventory.get(object.object_key), doc=documents.get(object.document_id)
    if (!stored || object.state==='erased' && (stored.size!==0 || doc && !doc.erased_at) || object.state==='ready' && (!doc || doc.erased_at || stored.size!==doc.size || stored.sha256!==doc.sha256) || !['ready','erased'].includes(object.state)) throw new Error('document_archive_integrity')
  }
  return service.exports.download(id)
}
