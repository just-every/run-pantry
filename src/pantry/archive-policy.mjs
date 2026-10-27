// Export and restore policy for `rer export` / `rer import`. Pantry's tables,
// documents and the move-in kit's journal travel; sign-in identities do not
// (a restored installation's owner signs in afresh and the books keep their
// people by email). A staged archive whose books do not balance is refused.
// Migrations seed one settings row each in the replaceable tables; the
// archive's rows take their place. Connections never travel with the books.
const disabled = (table,row) => {
 if(table==='pt_contacts')return {...row,autopay_payment_method:null,autopay_stripe_customer:null,autopay_mandate_id:null,autopay_revoked_at:row.autopay_revoked_at||'restored'}
 if(table==='pt_autopay_policies')return {...row,enabled:0,owner_id:''}
 if(table==='pt_autopay_setups')return {...row,status:'revoked',stripe_customer:''}
 if(table==='pt_text_consents')return {...row,revoked_at:'restored'}
 if(table==='pt_text_messages'&&['held','sending'].includes(row.status))return {...row,status:'cancelled',not_before:null}

 if(table==='pt_webhook_subscriptions')return {...row,enabled:0,owner_id:''}
 if(table==='pt_feed_items')return {...row,access_token:'',status:'disconnected',claim_id:null,claim_until:null}
 if(table==='pt_tax_reminder_preferences')return {...row,enabled:0,owner_id:'',owner_email:''}
 if(table==='pt_tax_reminder_batches')return {...row,status:row.status==='draft'?'cancelled':row.status}
 if(table==='pt_w9_requests')return {...row,token_hash:null}
 if(table==='pt_estimates')return {...row,link_token:null}
 if(table==='pt_collection_cases')return {...row,status:row.status==='approved'?'draft':row.status,approved_by:null,approved_revision:null}
 if(table==='pt_agent_permissions')return {...row,active:0,owner_id:'',owner_email:''}
 if(table==='pt_agents')return {...row,active:0}
 if(table==='pt_integrations')return {...row,revoked_at:'restored'}
 return row
}
export default {
 product: 'just-every/pantry',
 buckets: { PANTRY_DOCUMENTS: { prefix: 'documents/', objectReferences: { table: 'pt_document_objects', keyColumn: 'object_key' } } },
 // Receipts travel with the books; Base's source-bound portability journal
 // carries the restore fence. Neither journal contains erased field values.
 includeTables: ['pt_erasure_journal'],
 excludeTables: ['pt_hosted_backup_runs','pt_texting','pt_qbo_connection','pt_estimate_sibling_previews','pt_estimate_sibling_attempts','pt_webhook_secrets','pt_webhook_events','pt_webhook_deliveries','pt_webhook_attempts','pt_reader','pt_stripe','pt_gusto','pt_gusto_states','pt_xero_connection','pt_receipt_inbox'],
 exportRow: (table,row) => {
  if (table === 'pt_document_objects' && !['ready','erased'].includes(row.state)) throw new Error('document_storage_pending')
  return disabled(table,['pt_agents','pt_integrations'].includes(table)?{...row,token_hash:`disabled:${row.id}`}:row)
 },
 importSafety: {pt_autopay_policies:{enabled:[0],owner_id:['']},pt_autopay_setups:{status:['revoked'],stripe_customer:['']},pt_text_consents:{revoked_at:['restored']},pt_tax_reminder_preferences:{enabled:[0],owner_id:[''],owner_email:['']},pt_w9_requests:{token_hash:[null]},pt_collection_cases:{approved_by:[null],approved_revision:[null]},pt_agent_permissions:{active:[0],owner_id:[''],owner_email:['']},pt_estimates:{link_token:[null]},pt_webhook_subscriptions:{enabled:[0],owner_id:['']},pt_feed_items:{access_token:[''],status:['disconnected'],claim_id:[null],claim_until:[null]},pt_agents:{active:[0]},pt_integrations:{revoked_at:['restored']}},
 importRow: disabled,
 replaceableTables: ['pt_tax_reminder_preferences', 'pt_asset_settings', 'pt_dimension_settings', 'pt_retention_settings', 'pt_sending', 'pt_due_work', 'pt_books_agent', 'pt_invoice_document_settings', 'pt_invoice_templates'],
 requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
 validateStaged: async ({ read, manifest }) => {
  const objects = await read('pt_document_objects')
  if (objects.some(o => !['ready','erased'].includes(o.state))) return false
  const originals = new Map((await read('pt_documents')).map(d => [d.id,d]))
  const binaries = new Map(manifest.objects.filter(o => o.bucket === 'PANTRY_DOCUMENTS').map(o => [o.key,o]))
  for (const object of objects) {
   const binary = binaries.get(object.object_key), doc = originals.get(object.document_id)
   if (!binary) return false
   if (object.state === 'erased') { if (binary.size !== 0 || doc && !doc.erased_at) return false }
   else if (!doc || doc.erased_at || binary.size !== doc.size || binary.sha256 !== doc.sha256) return false
  }
  const entries = await read('pt_journal_entries'), lines = await read('pt_journal_lines')
  const byEntry = new Map()
  for (const l of lines) { const t = byEntry.get(l.entry_id) ?? { debit: 0, credit: 0 }; t.debit += Number(l.debit_cents); t.credit += Number(l.credit_cents); byEntry.set(l.entry_id, t) }
  const ids = new Set(entries.map(e => e.id))
  for (const e of entries) {
   if (e.status !== 'posted') continue
   const t = byEntry.get(e.id)
   if (!t || t.debit !== t.credit || t.debit <= 0) return false
   if (e.reverses_id && !ids.has(e.reverses_id)) return false
   if (e.reversed_by_id && !ids.has(e.reversed_by_id)) return false
  }
  return true
 },
}
