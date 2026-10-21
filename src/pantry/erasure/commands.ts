import { who } from '../access'
import type { Command } from '../context'
import { now, requireThat, sha256, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run, type Sql } from '../db'
import { CONTACT_PERSONAL, MARKER, erasureValues, scrub } from './personal'
import { erasurePreview, publicPreview } from './preview'
import { historyStatements } from './history'
import { memberStatements } from './member'
import { fenceStatements } from './fence'
import { eraseCopies } from './copies'
import { immutableCopies } from './immutable-copies'
import { runErasure } from './custody'
import { ownerSession } from './owner'
import { retainStatements, retentionCommands, erasureView } from './retention'

const preview: Command = {need:'owner',async run(c,b) { await ownerSession(c); return publicPreview(await erasurePreview(c,b)) }}
const execute: Command = {need:'owner',async run(c,b) {
  const authority = await ownerSession(c), p = await erasurePreview(c,b)
  requireThat(b.confirm==='ERASE','Type ERASE to confirm')
  requireThat(p.fingerprint===b.fingerprint,'Preview changed; review a fresh preview',409)
  requireThat(!p.blockers.length,'Erasure refused: '+p.blockers.map(r=>`${r.kind} ${r.number??r.id}: ${r.reason}`).join('; '),409)
  const reason = text(b.reason,'Reason',1000), requester = text(b.requester,'Requester',254), channel = text(b.channel,'Request channel',40)
  requireThat(['email','phone','in-person','other'].includes(channel),'Request channel is email, phone, in-person or other')
  const id = uid(), at = now(), member = p.kind==='member', person=p.kind==='contact-person', label = member ? `Former member ${crypto.randomUUID().replaceAll('-','').slice(0,8)}` : MARKER
  const values = person?[p.subject.name,p.subject.email,p.subject.phone].filter(Boolean):await erasureValues(c.db,p.subject,member)
  const history = await historyStatements(c.db,values,id,at,member?{email:p.id,label}:undefined)
  const counts: Record<string,Data> = {pt_audit:{valuesReplaced:history.counts.pt_audit},pt_approvals:{valuesReplaced:history.counts.pt_approvals}}
  const copies = await eraseCopies(c.db,{id:p.id,member:member||person,posted:p.posted,values,marker:label,erasureId:id,at})
  const immutable = await immutableCopies(c.db,{values,marker:label,member,erasureId:id})
  for (const [table,count] of Object.entries({...copies.counts,...immutable.counts})) counts[table]={...counts[table],...count}
  const writes: Sql[] = [], removed: {table:string;key:Record<string,unknown>}[] = []
  if(person) {
    const people=JSON.parse(p.parent.contacts_json)
    people.splice(p.personIndex!,1)
    const set:Data={contacts_json:JSON.stringify(people),revision:uid()}
    for(const key of CONTACT_PERSONAL)if(typeof p.parent[key]==='string')set[key]=scrub(p.parent[key],values)
    writes.push(q(`UPDATE pt_contacts SET ${Object.keys(set).map(k=>`${k}=?`).join(',')} WHERE id=? AND revision=?`,...Object.values(set),p.id,p.parent.revision),changed())
    counts.pt_contacts={fieldsReplaced:1,contactPeopleRemoved:1}
  } else if (member) {
    const result = await memberStatements(c.db,p.subject,label)
    writes.push(...result.statements); counts.pt_members={fieldsReplaced:2}; counts.oa_operators={identitiesRemoved:result.operators}
  } else {
    writes.push(guard('EXISTS (SELECT 1 FROM pt_contacts WHERE id=? AND revision=?)',p.id,p.subject.revision))
    if (p.posted) {
      writes.push(q(`UPDATE pt_contacts SET ${CONTACT_PERSONAL.map(k=>`${k}=?`).join(',')},contacts_json='[]',vendor_ein_hash='',active=0,erased_at=?,revision=? WHERE id=?`,...CONTACT_PERSONAL.map(()=>MARKER),at,uid(),p.id),changed())
      counts.pt_contacts={fieldsReplaced:CONTACT_PERSONAL.length+2}
    } else {
      for (const [table,column] of [['pt_vendor_aliases','vendor_id'],['pt_integration_contacts','contact_id'],['pt_contractor_tax','contact_id']] as const) {
        const n = (await one(c.db,`SELECT count(*) AS n FROM ${table} WHERE ${column}=?`,p.id))!.n
        writes.push(q(`DELETE FROM ${table} WHERE ${column}=?`,p.id)); counts[table]={rowsRemoved:n}
      }
      writes.push(q('DELETE FROM pt_contacts WHERE id=?',p.id),changed()); removed.push({table:'pt_contacts',key:{id:p.id}}); counts.pt_contacts={rowsRemoved:1}
    }
    const links = (await one(c.db,'SELECT count(*) AS n FROM pt_invoices WHERE customer_id=? AND link_token IS NOT NULL',p.id))!.n
    writes.push(q('UPDATE pt_invoices SET link_token=NULL,reminders_paused=1 WHERE customer_id=?',p.id)); counts.pt_invoices={linksRevoked:links}

  }
  const receipt = {id,at,subject:await sha256(`${p.kind}:${p.id}:${p.personIndex??''}`),request:{requesterDigest:await sha256(requester),channel,reason:scrub(reason,values,label)},counts,retained:p.retained,
    limitations:['Posted-entry free text','Connected services that already received data (DATA-001)','Downloaded files','Earlier backups'],marker:member?label:MARKER}
  await runErasure(c,[...authority,guard('(SELECT count(*) FROM pt_audit)=?',p.auditCount),
    q('INSERT INTO pt_erasure_journal VALUES (?,?,?,?)',id,receipt.subject,at,JSON.stringify(receipt)),...(!member&&p.posted?await retainStatements(c.db,p.id,id):[]),...copies.statements,...writes,...immutable.statements,...history.statements,...await fenceStatements(c.db,[...removed,...copies.removed]),
    q('DELETE FROM pt_erasure_scope WHERE erasure_id=?',id),audit(who(c.actor),'erasure.complete','erasure',id,{receipt})],{id:p.id,member:member||person,values})
  return receipt
}}
export const erasureCommands: Record<string,Command> = {'erasure.preview':preview,'erasure.execute':execute,...retentionCommands}
export async function erasureSettings(db: D1Database) {
  return {...await erasureView(db),receipts:(await all(db,'SELECT receipt FROM pt_erasure_journal ORDER BY at DESC')).map(r=>JSON.parse(r.receipt))}
}
