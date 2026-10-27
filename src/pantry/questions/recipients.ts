import { all, guard } from '../db'

// Being mentioned never grants access to financial records.
const eligible = `o.status = 'active' AND (o.role = 'owner' OR EXISTS (
  SELECT 1 FROM pt_members m JOIN pt_role_privacy p ON p.role = m.role
  WHERE m.email = lower(o.email) AND m.active = 1 AND m.role IN ('bookkeeper', 'accountant')
  AND m.bank_accounts IS NULL AND p.mask_bank = 0 AND p.mask_tin = 0))`
export const questionRecipients = (db: D1Database) => all(db, `SELECT lower(o.email) AS email, o.display_name AS name FROM oa_operators o WHERE ${eligible} ORDER BY o.display_name, o.email`)
export const recipientLive = (email: string) => guard(`EXISTS (SELECT 1 FROM oa_operators o WHERE lower(o.email) = ? AND ${eligible})`, email)
