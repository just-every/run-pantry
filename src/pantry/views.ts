// Read models for the screens. Every view is behind the read capability.
import { allowed, type Person } from './access'
import { addDays, longDay, period, type Data } from './core'
import { all, one } from './db'
import { entity } from './settings'

export async function lookups(db: D1Database) {
  return {
    accounts: await all(db, 'SELECT * FROM pt_accounts ORDER BY code'),
    contacts: await all(db, 'SELECT * FROM pt_contacts ORDER BY kind, name'),
    bankAccounts: await all(db, 'SELECT * FROM pt_bank_accounts ORDER BY name'),
    taxCodes: await all(db, 'SELECT * FROM pt_tax_codes WHERE active = 1 ORDER BY name'),
    names: await names(db),
  }
}

/** The first-run checklist and today's work queue, from completion evidence only. */
export async function overview(db: D1Database) {
  const n = async (sql: string, ...params: unknown[]) => Number((await one(db, sql, ...params))?.n ?? 0)
  const e = await entity(db)
  const accounts = await n('SELECT COUNT(*) AS n FROM pt_accounts')
  const opening = await n("SELECT COUNT(*) AS n FROM pt_journal_entries WHERE status = 'posted'")
  const stagedCutover = await n("SELECT COUNT(*) AS n FROM pt_cutovers WHERE status = 'staged'")
  const contacts = await n('SELECT COUNT(*) AS n FROM pt_contacts')
  const banks = await n('SELECT COUNT(*) AS n FROM pt_bank_accounts'), statements = await n('SELECT COUNT(*) AS n FROM pt_statements'), reconciled = await n('SELECT COUNT(*) AS n FROM pt_reconciliations')
  const locked = await n("SELECT COUNT(*) AS n FROM pt_periods WHERE status = 'locked'")
  const steps = [
    { key: 'business', title: 'Set up the business', done: !!e, detail: e ? `${e.legal_name}, ${e.state}; books start ${longDay(e.books_start)}` : 'Legal name, entity type, state, fiscal year and declared tax method', go: 'settings' },
    { key: 'chart', title: 'Chart of accounts and opening balances', done: accounts > 0 && opening > 0 && !stagedCutover, detail: !accounts ? 'Start a chart or move in from QuickBooks Online or Xero' : stagedCutover ? 'Imported opening balances wait for accountant sign-off' : opening ? `${accounts} accounts; balances posted` : `${accounts} accounts; no opening balances posted yet`, go: stagedCutover ? 'move-in' : 'books' },
    { key: 'contacts', title: 'Customers and vendors', done: contacts > 0, detail: contacts ? `${contacts} customers and vendors` : 'Add the businesses you invoice and pay', go: 'contacts' },
    { key: 'bank', title: 'Bank statements', done: banks > 0 && statements > 0 && reconciled > 0, detail: !banks ? 'Add a bank account' : !statements ? 'Import a CSV or OFX statement' : reconciled ? `${reconciled} statement${reconciled === 1 ? '' : 's'} reconciled` : 'Reconcile your first statement', go: 'bank' },
    { key: 'close', title: 'First close', done: locked > 0, detail: locked ? `${locked} period${locked === 1 ? '' : 's'} locked` : 'Complete the checklist and lock a month', go: 'close' },
  ]
  const queue = {
    journalDrafts: await n("SELECT COUNT(*) AS n FROM pt_journal_entries WHERE status = 'draft'"),
    invoiceDrafts: await n("SELECT COUNT(*) AS n FROM pt_invoices WHERE status IN ('draft', 'approved')"),
    unmatchedLines: await n('SELECT COUNT(*) AS n FROM pt_bank_lines l WHERE l.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines m WHERE m.bank_line_id = l.id AND m.active = 1)'),
    proposals: await n("SELECT COUNT(*) AS n FROM pt_proposals WHERE status = 'proposed'"),
    receipts: await n("SELECT COUNT(*) AS n FROM pt_receipts WHERE status = 'review'"),
    reopenRequests: await n("SELECT COUNT(*) AS n FROM pt_reopen_requests WHERE status = 'pending'"),
    questions: await n("SELECT COUNT(*) AS n FROM pt_questions WHERE status IN ('open', 'confirm')"),
  }
  const lastLocked = (await one<{ id: string | null }>(db, "SELECT MAX(id) AS id FROM pt_periods WHERE status = 'locked'"))?.id ?? null
  return { entity: e, steps, queue, closing: await closing(db, e?.books_start), lastLocked }
}

/** The period due to close: the month after the last lock, else the books' first month; never past this month. */
async function closing(db: D1Database, booksStart?: string) {
  const last = (await one<{ id: string | null }>(db, "SELECT MAX(id) AS id FROM pt_periods WHERE status = 'locked'"))?.id
  const next = last ? period(addDays(`${last}-28`, 7)) : booksStart ? period(addDays(booksStart, 1)) : null
  const current = new Date().toISOString().slice(0, 7)
  return next && next < current ? next : current
}

/** The name to show for each email that acts in these books: a member's name, else the operator's display name. Agents act as "agent:<name>". */
async function names(db: D1Database) {
  const rows = await all<{ email: string; name: string }>(db, "SELECT lower(email) AS email, display_name AS name FROM oa_operators UNION ALL SELECT lower(email) AS email, name FROM pt_members UNION ALL SELECT 'agent:' || name AS email, name FROM pt_agents")
  const out: Record<string, string> = {}
  for (const r of rows) if (r.name?.trim()) out[r.email] = r.name.trim()
  // Pantry acting by itself, named for the job it did.
  Object.assign(out, { 'pantry:reminders': 'Pantry (reminders)', 'pantry:recurring': 'Pantry (recurring invoices)', 'pantry:auto-match': 'Pantry (matched automatically)', 'pantry:stripe': 'Pantry (Stripe)', 'pantry:customer': 'The customer', 'agent:pantry': 'Pantry' })
  return out
}

export function actorView(actor: Person): Data {
  return { email: actor.email, name: actor.name, role: actor.role, can: { record: allowed(actor, 'record'), post: allowed(actor, 'post'), lock: allowed(actor, 'lock'), reopen: allowed(actor, 'reopen'), owner: allowed(actor, 'owner') } }
}

export async function activity(db: D1Database) {
  return {
    audit: await all(db, 'SELECT * FROM pt_audit ORDER BY at DESC, id LIMIT 300'),
    approvals: await all(db, 'SELECT * FROM pt_approvals ORDER BY at DESC, id LIMIT 300'),
  }
}

export async function documents(db: D1Database) {
  return all(db, `SELECT d.id, d.name, d.media_type, d.size, d.sha256, d.linked_kind, d.linked_id, d.note, d.uploaded_by, d.uploaded_at, CASE d.linked_kind
      WHEN 'bill' THEN (SELECT 'Bill ' || b.reference FROM pt_bills b WHERE b.id = d.linked_id)
      WHEN 'invoice' THEN (SELECT CASE i.kind WHEN 'credit' THEN 'Credit note ' ELSE 'Invoice ' END || i.number FROM pt_invoices i WHERE i.id = d.linked_id)
      WHEN 'journal' THEN (SELECT 'Journal entry' || COALESCE(' ' || j.number, '') FROM pt_journal_entries j WHERE j.id = d.linked_id)
      WHEN 'payment' THEN (SELECT 'Payment · ' || c.name FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id WHERE p.id = d.linked_id)
      WHEN 'statement' THEN (SELECT 'Statement · ' || a.name FROM pt_statements s JOIN pt_bank_accounts a ON a.id = s.bank_account_id WHERE s.id = d.linked_id)
    END AS linked_label FROM pt_documents d ORDER BY d.uploaded_at DESC, d.id`)
}
