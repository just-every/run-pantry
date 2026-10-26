import { must } from '../access'
import { assertDoor } from '../access-policy/doors'
import type { Command, Context } from '../context'
import { all } from '../db'
import { lateFeePolicy, savePolicy } from './policy'
import { preparationView, prepareFee } from './prepare'

export const lateFeeCommands: Record<string, Command> = {
  'late-fee-policy.save': savePolicy,
  'late-fee.prepare': prepareFee,
}

export async function lateFeesView(c: Context) {
  must(c.actor, 'read')
  await assertDoor(c, '/api/pantry/invoice-documents')
  const [policy, accounts, taxCodes, preparations] = await Promise.all([
    lateFeePolicy(c.db),
    all(c.db, "SELECT id,code,name FROM pt_accounts WHERE type='income' AND active=1 ORDER BY code"),
    all(c.db, 'SELECT id,name,rate_milli_percent FROM pt_tax_codes WHERE active=1 ORDER BY name'),
    all(c.db, `SELECT f.*,i.number AS invoice_number,i.status AS invoice_status,s.number AS source_number
      FROM pt_late_fee_preparations f JOIN pt_invoices i ON i.id=f.invoice_id
      JOIN pt_invoices s ON s.id=f.source_invoice_id ORDER BY f.prepared_at DESC,f.id DESC`),
  ])
  return { policy, accounts, taxCodes, preparations: preparations.map(preparationView) }
}
