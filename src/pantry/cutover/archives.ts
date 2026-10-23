// A reviewed manifest and extracted original files. Never infer a source ID
// from a party name or filename; uncertain originals remain in the queue.
import { authority,must,who } from '../access'
import type { Command,Context } from '../context'
import { now,requireThat,sha256,text,uid,type Data } from '../core'
import { all,audit,changed,guard,one,q,run,type Sql } from '../db'
import { documentStatements } from '../documents'
const PROVIDERS=['quickbooks-online','xero','freshbooks','hubdoc','dext']
const TABLES:Record<string,string>={invoice:'pt_invoices',bill:'pt_bills',journal:'pt_journal_entries',payment:'pt_payments',statement:'pt_statements',history:'pt_history_lines'}
async function target(c:Context,kind:string,id:string){requireThat(TABLES[kind],'Choose a supported transaction type');requireThat(await one(c.db,`SELECT id FROM ${TABLES[kind]} WHERE id=?`,id),'Mapped transaction is missing',404)}
async function prepare(c:Context,b:Data){
 must(c.actor,'owner');const provider=text(b.provider,'Archive provider'),archiveKey=text(b.archiveKey,'Export identity',200)
 requireThat(PROVIDERS.includes(provider),'Choose an archive provider');requireThat(Array.isArray(b.files)&&b.files.length>0&&b.files.length<=10,'Choose one to ten original files per batch')
 const seen=new Set<string>(),files:Data[]=[];let total=0
 for(const f of b.files){
  const sourceId=text(f.sourceId,'Document source ID',200);requireThat(!seen.has(sourceId),'Document source IDs must be unique');seen.add(sourceId)
  const name=text(f.name,'Original file name',200),mediaType=text(f.mediaType,'File type',100)
  requireThat(/^(application\/pdf|image\/(jpeg|png|webp)|text\/(plain|csv))$/.test(mediaType),'Use an original PDF, supported image, text or CSV')
  requireThat(typeof f.base64==='string'&&/^[A-Za-z0-9+/]+=*$/.test(f.base64)&&f.base64.length<=11_000_000,'Invalid or oversized encoded original')
  const bytes=Uint8Array.from(atob(f.base64),(ch:string)=>ch.charCodeAt(0));total+=bytes.length;requireThat(bytes.length>0&&total<=8_000_000,'A batch holds at most 8 MB of original bytes')
  const hash=await sha256(bytes);if(f.sha256)requireThat(f.sha256===hash,'An original does not match its expected SHA-256')
  const system=f.sourceSystem?text(f.sourceSystem,'Transaction source system',100):provider,transactionId=f.transactionSourceId?text(f.transactionSourceId,'Transaction source ID',200):'',kind=f.kind?text(f.kind,'Transaction type'):'',targetId=f.targetId?text(f.targetId,'Pantry transaction ID'):''
  let mapping:Data|null=null
  if(transactionId){requireThat(TABLES[kind],'A transaction source ID needs its record type');mapping=await one(c.db,'SELECT * FROM pt_archive_source_links WHERE source_system=? AND source_kind=? AND source_id=?',system,kind,transactionId)}
  if(targetId){requireThat(transactionId,'Confirm an original transaction source ID for this mapping');await target(c,kind,targetId);requireThat(!mapping||mapping.target_id===targetId,'This source ID already maps to another transaction',409)}
  const linkedId=targetId||mapping?.target_id||null;if(linkedId)await target(c,kind,linkedId)
  files.push({sourceId,name,mediaType,bytes,sha256:hash,size:bytes.length,sourceSystem:system,transactionSourceId:transactionId,kind,linkedId,confirmMapping:!!targetId})
 }
 const summary=files.map(({bytes,...f})=>f),fingerprint=await sha256(new TextEncoder().encode(JSON.stringify({provider,archiveKey,files:summary})))
 return {provider,archiveKey,files,fingerprint,total}
}
export async function archivesView(c:Context){must(c.actor,'owner');const archives=await all(c.db,`SELECT a.*,COUNT(f.id) AS file_count,COALESCE(SUM(f.size),0) AS byte_count FROM pt_document_archives a LEFT JOIN pt_archive_documents f ON f.archive_id=a.id GROUP BY a.id ORDER BY a.imported_at DESC,a.id`),files=await all(c.db,`SELECT f.*,d.name,d.linked_kind,d.linked_id,d.erased_at FROM pt_archive_documents f JOIN pt_documents d ON d.id=f.document_id ORDER BY f.archive_id,d.name`);return {archives,files,unlinked:files.filter(f=>!f.linked_id),links:await all(c.db,'SELECT * FROM pt_archive_source_links ORDER BY source_system,source_kind,source_id')}}
export const archiveCommands:Record<string,Command>={
 'archive.preview':{need:'owner',async run(c,b){const p=await prepare(c,b);return {...p,files:p.files.map(({bytes,...f})=>f)}}},
 'archive.import':{need:'owner',async run(c,b){const p=await prepare(c,b);requireThat(b.fingerprint===p.fingerprint,'Review this exact batch before importing',409)
 const existing=await one(c.db,'SELECT * FROM pt_document_archives WHERE provider=? AND archive_key=?',p.provider,p.archiveKey);if(existing){requireThat(existing.fingerprint===p.fingerprint,'This export identity was already imported with different bytes or mappings',409);return {id:existing.id,replayed:true,...await archivesView(c)}}
 const id=uid(),at=now(),statements:Sql[]=[authority(c.actor,'owner'),q('INSERT INTO pt_document_archives(id,provider,archive_key,fingerprint,imported_at,imported_by) VALUES(?,?,?,?,?,?)',id,p.provider,p.archiveKey,p.fingerprint,at,c.actor.email)]
 for(const f of p.files){if(f.linkedId){statements.push(guard(`EXISTS(SELECT 1 FROM ${TABLES[f.kind]} WHERE id=?)`,f.linkedId));if(f.confirmMapping)statements.push(q('INSERT INTO pt_archive_source_links(source_system,source_kind,source_id,target_id,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source_system,source_kind,source_id) DO NOTHING',f.sourceSystem,f.kind,f.transactionSourceId,f.linkedId,c.actor.email,at));statements.push(guard('EXISTS(SELECT 1 FROM pt_archive_source_links WHERE source_system=? AND source_kind=? AND source_id=? AND target_id=?)',f.sourceSystem,f.kind,f.transactionSourceId,f.linkedId))}
 const doc=await documentStatements(c.actor.email,{name:f.name,mediaType:f.mediaType,bytes:f.bytes,linkedKind:f.linkedId?f.kind:null,linkedId:f.linkedId,note:`Imported original from ${p.provider}`});statements.push(...doc.statements,q('INSERT INTO pt_archive_documents(id,archive_id,source_id,source_system,transaction_source_id,document_id,sha256,size,placed_by) VALUES(?,?,?,?,?,?,?,?,?)',uid(),id,f.sourceId,f.sourceSystem,f.transactionSourceId,doc.id,doc.sha256,f.size,f.linkedId?c.actor.email:null))}
 statements.push(audit(who(c.actor),'move-in.archive','document-archive',id,{provider:p.provider,archiveKey:p.archiveKey,count:p.files.length,bytes:p.total,fingerprint:p.fingerprint,files:p.files.map(f=>({sourceId:f.sourceId,sha256:f.sha256,size:f.size,linkedId:f.linkedId}))}));await run(c.db,statements);return {id,...await archivesView(c)}}},
 'archive.place':{need:'owner',async run(c,b){const f=await one(c.db,'SELECT f.*,d.linked_id,d.erased_at FROM pt_archive_documents f JOIN pt_documents d ON d.id=f.document_id WHERE f.id=?',text(b.id,'Archive document'));requireThat(f,'Original is missing',404);requireThat(!f.linked_id&&!f.erased_at,'Only an unplaced retained original can be placed',409);const kind=text(b.kind,'Record type'),targetId=text(b.targetId,'Pantry record ID');await target(c,kind,targetId)
 await run(c.db,[authority(c.actor,'owner'),guard(`EXISTS(SELECT 1 FROM ${TABLES[kind]} WHERE id=?)`,targetId),q('UPDATE pt_archive_documents SET revision=revision+1,placed_by=? WHERE id=? AND revision=?',c.actor.email,f.id,b.revision),changed(),q('UPDATE pt_documents SET linked_kind=?,linked_id=? WHERE id=? AND linked_id IS NULL AND erased_at IS NULL',kind,targetId,f.document_id),changed(),audit(who(c.actor),'move-in.archive-place','document',f.document_id,{archiveId:f.archive_id,sourceId:f.source_id,sha256:f.sha256,linkedKind:kind,linkedId:targetId})]);return archivesView(c)}}
}
