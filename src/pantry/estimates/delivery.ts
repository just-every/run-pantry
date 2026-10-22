import { runtimeBindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { authority, ownerEmail, pantry, who } from '../access'
import { bankAuthority } from '../access-policy/banks'
import { customerRecipients } from '../customer-profile'
import { now, requireThat, sha256, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run } from '../db'
import { invoicePdf } from '../invoice-pdf'
import { bytesBase64 } from '../invoice-logo'
import { sendingSettings } from '../delivery'
import type { Context } from '../context'
import { estimate, estimateRaw } from './store'
import { estimateDocument } from './documents'

export async function sendEstimate(c:Context,b:Data) {
  requireThat(c.actor.kind==='person','A person sends the estimate',403)
  const {row,p}=await estimateRaw(c.db,text(b.id,'Estimate'))
  requireThat(row.revision===b.revision,'Estimate changed; reload before sending',409)
  requireThat(row.status!=='accepted','This estimate was already accepted',409)
  const customer=await one(c.db,"SELECT * FROM pt_contacts WHERE id=? AND active=1",row.customer_id)
  requireThat(customer,'Customer is inactive',409)
  const recipients=customerRecipients(customer)
  requireThat(recipients.length,'Add a customer billing email before sending',409)
  const mailer=operatorMail(runtimeBindings(c.env)) as unknown as {send(message:Data):Promise<Data>}|undefined
  requireThat(mailer,'Set up a mail provider before sending an estimate',409)
  const bytes=crypto.getRandomValues(new Uint8Array(24)), token=row.link_token??btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  const retained=await one(c.db,'SELECT * FROM pt_estimate_documents WHERE estimate_id=? AND revision=?',row.id,row.revision)
  const document=retained?JSON.parse(retained.document):await estimateDocument(c.db,row,p)
  const pdf=retained?Uint8Array.from(atob(retained.pdf_base64),(x:string)=>x.charCodeAt(0)):invoicePdf(document)
  const hash=retained?.sha256??await sha256(pdf),at=now()
  const deliveries=recipients.map(recipient=>({id:uid(),recipient}))
  await run(c.db,[authority(c.actor,'record'),...(p.deposit?bankAuthority(c.actor,[p.deposit.bankAccountId]):[]),
    guard("EXISTS(SELECT 1 FROM pt_estimates WHERE id=? AND revision=? AND status IN ('draft','sent') AND erased_at IS NULL)",row.id,row.revision),
    ...(retained?[]:[q('INSERT INTO pt_estimate_documents(estimate_id,revision,document,pdf_base64,sha256,retained_at)VALUES(?,?,?,?,?,?)',row.id,row.revision,JSON.stringify(document),bytesBase64(pdf),hash,at)]),
    q("UPDATE pt_estimates SET status='sent',link_token=?,sent_at=COALESCE(sent_at,?) WHERE id=? AND revision=?",token,at,row.id,row.revision),changed(),
    ...deliveries.map(d=>q("INSERT INTO pt_estimate_deliveries(id,estimate_id,revision,recipient,status,at,attachment_sha256)VALUES(?,?,?,?,'sending',?,?)",d.id,row.id,row.revision,d.recipient,at,hash)),
    audit(who(c.actor),'estimate.sent','estimate',row.id,{revision:row.revision,sha256:hash,recipients:recipients.length})])
  const link=`${runtimeBindings(c.env).AUTH_ORIGIN}/e/${token}`,settings=await sendingSettings(c.db)
  for(const d of deliveries){
    let status='uncertain',detail='transport_failure'
    try{
      const result=await mailer.send({deliveryId:d.id,from:c.env.MAIL_FROM,to:[d.recipient],replyTo:settings.reply_to||await ownerEmail(c.db,c.env),subject:`Estimate ${row.number} from ${document.business}`,
        text:`${document.business} sent estimate ${row.number}. Review and accept this estimate: ${link}\nThe estimate is attached as a PDF.`,
        attachments:[{filename:`${row.number}.pdf`,contentType:'application/pdf',content:pdf}]})
      status=result.status==='development'?'suppressed':String(result.status);detail=String(result.code??'')
    }catch(error){if((error as Error).name==='MailValidationError'){status='failed';detail=String((error as Data).code??'message_refused')}}
    await run(c.db,[q('UPDATE pt_estimate_deliveries SET status=?,detail=? WHERE id=?',status,detail,d.id),audit(who(c.actor),'estimate.delivery','estimate',row.id,{revision:row.revision,deliveryId:d.id,status})])
  }
  return estimate(c.db,row.id)
}

// Called only by the acceptance that reserved these deliveries atomically.
// An uncertain provider result is recorded and never replayed by the public link.
export async function confirmAcceptance(env:Context['env'],db:D1Database,row:Data,document:Data,deliveries:Data[]) {
  const mailer=operatorMail(runtimeBindings(env)) as unknown as {send(message:Data):Promise<Data>}|undefined
  const settings=await sendingSettings(db),link=`${runtimeBindings(env).AUTH_ORIGIN}/e/${row.link_token}/estimate.pdf`
  for(const d of deliveries){
    let status='failed',detail='mail_provider_unavailable'
    if(mailer){
      status='uncertain';detail='transport_failure'
      try{
        const result=await mailer.send({deliveryId:d.id,from:env.MAIL_FROM,to:[d.recipient],replyTo:settings.reply_to||await ownerEmail(db,env),
          subject:`Accepted estimate ${row.number} from ${document.business}`,
          text:`${row.accepted_name} electronically signed estimate ${row.number}, revision ${row.accepted_revision}, at ${row.accepted_at}. Download the accepted estimate PDF: ${link}`})
        status=result.status==='development'?'suppressed':String(result.status);detail=String(result.code??'')
      }catch(error){if((error as Error).name==='MailValidationError'){status='failed';detail=String((error as Data).code??'message_refused')}}
    }
    await run(db,[q('UPDATE pt_estimate_deliveries SET status=?,detail=? WHERE id=?',status,detail,d.id),
      audit(pantry('customer'),'estimate.acceptance-delivery','estimate',row.id,{revision:row.accepted_revision,deliveryId:d.id,status})])
  }
}
