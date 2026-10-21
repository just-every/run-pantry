// Export and restore policy for `rer export` / `rer import`. Pantry's tables,
// documents and the move-in kit's journal travel; sign-in identities do not
// (a restored installation's owner signs in afresh and the books keep their
// people by email). A staged archive whose books do not balance is refused.
// Migrations seed one settings row each in the replaceable tables; the
// archive's rows take their place.
export default {
 product: 'just-every/pantry',
 // Receipts travel with the books; Base's source-bound portability journal
 // carries the restore fence. Neither journal contains erased field values.
 includeTables: ['pt_erasure_journal'],
 excludeTables: ['pt_webhook_secrets','pt_webhook_events','pt_webhook_deliveries','pt_webhook_attempts'],
 exportRow: (table,row) => table==='pt_webhook_subscriptions'?{...row,enabled:0,owner_id:''}:row,
 importSafety: {pt_webhook_subscriptions:{enabled:[0],owner_id:['']}},
 importRow: (table,row) => table==='pt_webhook_subscriptions'?{...row,enabled:0,owner_id:''}:row,
 replaceableTables: ['pt_retention_settings', 'pt_sending', 'pt_due_work', 'pt_books_agent', 'pt_invoice_document_settings', 'pt_invoice_templates'],
 requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
 validateStaged: async ({ read }) => {
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
