// One deny-by-default boundary for the narrower roles, shared by ordinary
// handlers and their direct HTTP transports. Full-book reports require full
// bank visibility; custom reports additionally check their native source.
import { type Actor, type Person } from '../access'
import { requireThat, type Data } from '../core'
import { all, one } from '../db'
import type { Context } from '../context'

export const narrow = (actor: Actor) => actor.kind === 'person' && ['sales', 'payables-clerk', 'time-only'].includes(actor.role)
export const limitedBanks = (actor: Actor) => actor.kind === 'person' && actor.role !== 'owner' && actor.policy?.bankAccounts !== null && actor.policy?.bankAccounts !== undefined
export function financialSourceAllowed(actor: Actor, source: string) {
  if (actor.kind !== 'person') return false
  if (actor.role === 'owner') return true
  if (actor.role === 'time-only') return false
  if (actor.role === 'sales') return source === 'sales-by-customer'
  if (actor.role === 'payables-clerk') return source === 'expenses-by-vendor'
  return !limitedBanks(actor)
}
const saleCommands = new Set(['estimate.save-draft', 'estimate.send', 'estimate.convert', 'estimate.refresh-invoice', 'contact.save', 'invoice.save-draft', 'invoice.approve', 'invoice.approve-issue', 'invoice.issue', 'invoice.send', 'invoice.reminders', 'recurring.save', 'recurring.approve', 'recurring.price', 'recurring.approve-price', 'recurring.status', 'time.save', 'time-project.save'])
const payableCommands = new Set(['contact.save', 'bill.save', 'bill.record', 'bill.approve', 'bill.post', 'bill.waive-evidence', 'bill.update', 'bill.submit', 'bill.schedule', 'recurring-bill.save', 'recurring-bill.generate', 'recurring-bill.status', 'document.upload', 'time.save'])

export async function assertDoor(c: Context, path: string, body?: Data) {
  const actor = c.actor
  if (actor.kind !== 'person' || actor.role === 'owner') return
  const url = new URL(path, c.request.url), door = url.pathname.replace(/^\/api\/pantry\//, '').replace(/^\//, '')
  const op = door.startsWith('command/') ? door.slice(8) : null
  // Original bytes and full accountant packages cannot be field-masked.
  if ((actor.policy?.maskTin || actor.policy?.maskBank) && /^(documents|package)\//.test(door)) requireThat(false, 'Original files and accountant packages require unmasked access; ask the owner', 403)
  if (narrow(actor)) {
    if (op) {
      const permitted = actor.role === 'time-only' ? op === 'time.save' : actor.role === 'sales' ? saleCommands.has(op) : payableCommands.has(op)
      requireThat(permitted, 'This action is not part of your role', 403)
      if (op === 'document.upload') requireThat(body?.linkedKind === 'bill' && !!await one(c.db, 'SELECT id FROM pt_bills WHERE id = ?', body?.linkedId), 'Choose a bill for this document', 403)
      if (op === 'contact.save') requireThat(body?.kind === (actor.role === 'sales' ? 'customer' : 'vendor'), 'This contact is not part of your role', 403)
      if (actor.role === 'sales') requireThat(!body?.deposit && !body?.depositId && !body?.depositAmount, 'Banking is not part of the sales role', 403)
    } else {
      const shared = ['state', 'time', 'sales', 'search'].includes(door)
      const custom = /^(custom-reports|management-packages)(\/|$)/.test(door)
      const sale = actor.role === 'sales' && (/^(customers|estimates)\//.test(door) || door === 'estimates' || door === 'invoice-documents' || door === 'exemptions' || /^invoice-documents\/[^/]+\/(pdf|preview)$/.test(door))
      const payable = actor.role === 'payables-clerk' && (/^vendors\/[^/]+\/history$/.test(door) || /^documents\/[^/]+$/.test(door) && !!await one(c.db, "SELECT id FROM pt_documents WHERE id = ? AND linked_kind = 'bill'", door.slice(10)))
      requireThat(actor.role === 'time-only' ? door === 'state' || door === 'time' : shared || custom || sale || payable, 'This screen is not part of your role', 403)
    }
  }
  if (limitedBanks(actor) && !narrow(actor)) {
    if (!op) {
      // Bank views are filtered below; reconcile is checked against its account.
      const safe = ['state', 'time', 'sales', 'search', 'bank', 'bank/lines', 'invoice-documents', 'customer-deposits', 'estimates'].includes(door) || /^estimates\//.test(door) || /^reconciliation\//.test(door) || /^(custom-reports|management-packages)(\/|$)/.test(door)
      requireThat(safe, 'This screen requires access to all bank accounts', 403)
      if (door.startsWith('reconciliation/')) {
        const statement = await one(c.db, 'SELECT bank_account_id FROM pt_statements WHERE id = ?', door.slice(15))
        requireThat(statement && actor.policy!.bankAccounts!.includes(statement.bank_account_id), 'Bank account is outside your access', 403)
      }
    } else {
      // A global rule, feed link, ledger or close workflow can change accounts
      // not present in its request. It requires full bank authority.
      requireThat(/^(invoice\.|estimate\.|customer-deposit\.|bill\.|contact\.save$|payment\.|time\.|time-project\.|statement\.|reconciliation\.)/.test(op), 'This action requires access to all bank accounts', 403)
    }
  }
  if (actor.policy?.maskTin && /1099|w9|w-9/i.test(door)) requireThat(false, 'Tax identity access is masked for your role', 403)
  if (body && limitedBanks(actor)) await checkBankTargets(c, body)
}

async function checkBankTargets(c: Context, body: Data) {
  const actor = c.actor as Person, allowed = actor.policy!.bankAccounts!
  const values: string[] = [], collect = (v: unknown, key = '') => { if (typeof v === 'string' && /(^id$|Ids?$)/.test(key)) values.push(v); else if (Array.isArray(v)) v.forEach(child => collect(child, key)); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, child]) => collect(child, k)) }
  collect(body)
  // Check existing record ids as well as explicit bankAccountId: an approval
  // request usually carries only its document id, and a saved deposit lives
  // on the document rather than the approval request.
  if (!values.length) return
  const ids = JSON.stringify([...new Set(values)]), targets = 'IN (SELECT value FROM json_each(?))'
  const groups = await Promise.all([
    all(c.db, `SELECT id AS bank_id FROM pt_bank_accounts WHERE id ${targets} OR account_id ${targets}`, ids, ids),
    all(c.db, `SELECT bank_account_id AS bank_id FROM pt_statements WHERE id ${targets}`, ids),
    all(c.db, `SELECT bank_account_id AS bank_id FROM pt_bank_lines WHERE id ${targets}`, ids),
    all(c.db, `SELECT bank_account_id AS bank_id FROM pt_payments WHERE id ${targets}`, ids),
    all(c.db, `SELECT bank_account_id AS bank_id FROM pt_customer_deposits WHERE id ${targets}`, ids),
    all(c.db, `SELECT json_extract(input,'$.deposit.bankAccountId') AS bank_id FROM pt_estimates WHERE id ${targets}`, ids),
    all(c.db, `SELECT COALESCE(json_extract(deposit,'$.bankAccountId'),json_extract(deposit,'$.bankId')) AS bank_id FROM pt_invoices WHERE id ${targets} AND deposit IS NOT NULL`, ids),
    all(c.db, `SELECT b.id AS bank_id FROM pt_journal_lines l JOIN pt_bank_accounts b ON b.account_id=l.account_id WHERE l.id ${targets} OR l.entry_id ${targets}`, ids, ids),
  ])
  requireThat(groups.flat().every(r => !r.bank_id || allowed.includes(r.bank_id)), 'Bank account is outside your access', 403)
}

export async function projectAccess(c: Context, value: unknown, path = new URL(c.request.url).pathname): Promise<any> {
  const actor = c.actor
  if (actor.kind !== 'person' || actor.role === 'owner') return value
  const door = path.replace(/^\/api\/pantry\//, '').split('?')[0], v = value as Data
  let out: any = v
  if (door === 'state' && narrow(actor)) {
    if (actor.role === 'time-only') return { actor: { email: v.actor.email, name: v.actor.name, role: v.actor.role, can: v.actor.can }, names: { [actor.email]: actor.name }, settings: { entity: v.settings?.entity ? { legal_name: v.settings.entity.legal_name } : null }, accounts: [], contacts: [], bankAccounts: [], taxCodes: [], items: [], overview: null }
    const sales = actor.role === 'sales'
    out = { ...v, contacts: v.contacts?.filter((r: Data) => r.kind === (sales ? 'customer' : 'vendor')), bankAccounts: [], accounts: v.accounts?.filter((r: Data) => sales ? r.type === 'income' : r.type === 'expense'), overview: null,
      settings: { entity: v.settings?.entity, issuingLimits: v.settings?.issuingLimits, members: [], agents: [], rolePrivacy: [], choices: v.settings?.choices } }
  }
  if (door === 'exemptions' && actor.role === 'sales') out = { today: v.today, certificates: v.certificates.map((e: Data) => ({ id: e.id, customer_id: e.customer_id, states: e.states, valid_from: e.valid_from, expires_on: e.expires_on, active: e.active })) }
  if (door === 'sales' && narrow(actor)) {
    const sales = actor.role === 'sales'
    out = { ...v, invoices: sales ? v.invoices : [], recurring: sales ? v.recurring : [], deliveries: sales ? v.deliveries : [], reminders: sales ? v.reminders : [], onlinePayments: [], bills: sales ? [] : v.bills, capturedBills: sales ? [] : v.capturedBills, recurringBills: sales ? [] : v.recurringBills, approvalRules: [], vendorCredits: sales ? [] : v.vendorCredits, payments: [] }
  }
  if (narrow(actor) && /^(customers|vendors)\//.test(door)) out = { ...v, rows: v.rows?.filter((r: Data) => actor.role === 'sales' ? ['invoice', 'credit', 'estimate'].includes(r.kind) : r.kind === 'bill') }
  if (limitedBanks(actor) && !narrow(actor) && door === 'sales') out = { ...v, payments: v.payments?.filter((p: Data) => actor.policy!.bankAccounts!.includes(p.bank_account_id)) }
  if (limitedBanks(actor) && !narrow(actor) && door === 'state') {
    const ids = actor.policy!.bankAccounts!, banks = v.bankAccounts?.filter((b: Data) => ids.includes(b.id)) ?? [], bankLedger = new Set(banks.map((b: Data) => b.account_id))
    out = { ...v, bankAccounts: banks, accounts: v.accounts?.filter((a: Data) => a.subtype !== 'bank' || bankLedger.has(a.id)), overview: null }
  }
  if (limitedBanks(actor) && door === 'bank') out = { accounts: v.accounts?.filter((b: Data) => actor.policy!.bankAccounts!.includes(b.id)), statements: v.statements?.filter((s: Data) => actor.policy!.bankAccounts!.includes(s.bank_account_id)) }
  if (limitedBanks(actor) && door === 'bank/lines') out = { lines: v.lines?.filter((b: Data) => actor.policy!.bankAccounts!.includes(b.bank_account_id)), pending: v.pending?.filter((b: Data) => actor.policy!.bankAccounts!.includes(b.bank_account_id)), suggestions: {}, suggestionRates: [], recordedPayments: [], depositProposals: [] }
  if (door === 'sales' && Array.isArray(out.bills)) out = { ...out, bills: out.bills.map((b: Data) => { const ownerApprovalRequired = actor.policy?.billLimit != null && b.total_cents > actor.policy.billLimit; return { ...b, ownerApprovalRequired, lifecycle: ownerApprovalRequired && b.status === 'draft' ? { ...b.lifecycle, nextActor: 'Owner' } : b.lifecycle } }) }
  if (/^(estimates(\/|$)|customers\/|command\/estimate\.)/.test(door)) out = estimateAccess(out, actor)
  return redact(out, actor)
}
function redact(value: any, actor: Person): any {
  if (Array.isArray(value)) return value.map(v => redact(v, actor))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, v]) => {
    if (actor.policy?.maskTin && /(^|_)(tin|ein|ssn)(_|$)|(tin|ein|ssn)(Last4|Kind|Hash)$|tax.?id|taxpayer/i.test(key)) return [key, v ? '••••' : v]
    if (actor.policy?.maskBank && /routing|(^|_)last4$|number_last4|account_number|bank_number/i.test(key)) return [key, v ? '••••' : v]
    if (typeof v === 'string' && /^[\[{]/.test(v)) { try { return [key, JSON.stringify(redact(JSON.parse(v), actor))] } catch {} }
    return [key, redact(v, actor)]
  }))
}

// Customer acceptance is evidence of the exact sent revision. Its IP is kept
// for the owner; a sales workflow does not grant bank-source visibility.
function estimateAccess(value: any, actor: Person): any {
  if (Array.isArray(value)) return value.map(v => estimateAccess(v, actor))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['ip', 'accepted_ip'].includes(key) && !(actor.role === 'sales' && ['bankAccountId', 'bank_account_id'].includes(key))).map(([key, child]) => [key, estimateAccess(child, actor)]))
}
