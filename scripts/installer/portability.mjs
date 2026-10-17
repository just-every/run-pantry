// Export and restore policy for `rer export` / `rer import`. Pantry's tables,
// documents and the move-in kit's journal travel; sign-in identities do not
// (a restored installation's owner signs in afresh and the books keep their
// people by email). A staged archive whose books do not balance is refused.
// Migrations seed one settings row each in the replaceable tables; the
// archive's rows take their place.
export default {
 product: 'just-every/pantry',
 replaceableTables: ['pt_sending', 'pt_due_work', 'pt_books_agent'],
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
