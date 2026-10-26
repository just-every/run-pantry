// QuickBooks Online's cutover package: seven report exports saved as CSV, each
// row parsed into one import record. See MOVE-IN.md.
import { date, requireThat, text } from '../core'
import { usDate } from '../statement-files'
import { amount, asOf, report as readReport } from './report'
import { bankRecords, collector, type Account, type Package, type Parsed, type Source, type TbRow } from './source'
import { parseQboSnapshot } from './qbo-snapshot'

const FILES = ['accounts', 'customers', 'vendors', 'trialBalance', 'openInvoices', 'unpaidBills', 'generalLedger'] as const
const LABELS: Record<string, string> = { accounts: 'Account List', customers: 'Customer Contact List', vendors: 'Vendor Contact List', trialBalance: 'Trial Balance', openInvoices: 'Open Invoices', unpaidBills: 'Unpaid Bills', generalLedger: 'General Ledger' }
const report = (source: string, required: string[], label: string) => readReport(source, required, label, 'Export the report from QuickBooks Online unchanged.')

/** QuickBooks Online account types → Pantry type and role. */
const ACCOUNT_TYPES: Record<string, [string, string]> = {
  'bank': ['asset', 'bank'],
  'accounts receivable (a/r)': ['asset', 'receivable'],
  'other current assets': ['asset', 'other'],
  'fixed assets': ['asset', 'other'],
  'other assets': ['asset', 'other'],
  'accounts payable (a/p)': ['liability', 'payable'],
  'credit card': ['liability', 'other'],
  'other current liabilities': ['liability', 'other'],
  'long term liabilities': ['liability', 'other'],
  'equity': ['equity', 'other'],
  'income': ['income', 'other'],
  'other income': ['income', 'other'],
  'cost of goods sold': ['expense', 'other'],
  'expenses': ['expense', 'other'],
  'other expense': ['expense', 'other'],
}

function parse(p: Package): Parsed {
  if (p.files.apiSnapshot) return parseQboSnapshot(p)
  const c = collector(), { attempt, refuse } = c

  const accounts = report(p.files.accounts.content, ['type', 'detail type'], 'Account List')
  const accountNames = new Map<string, Account>()
  for (const r of accounts.rows) attempt('account', 'accounts', r.row, () => {
    const name = text(r.cells['full name'] ?? r.cells['account'], 'Account name', 200)
    const mapped = ACCOUNT_TYPES[(r.cells['type'] ?? '').toLowerCase()]
    requireThat(mapped, `Account type "${r.cells['type']}" is not a QuickBooks Online account type Pantry maps`)
    const detail = r.cells['detail type'] ?? ''
    const subtype = mapped[0] === 'equity' && /retained earnings/i.test(detail) ? 'retained' : mapped[0] === 'liability' && /sales tax payable/i.test(detail) ? 'tax' : mapped[1]
    const code = (r.cells['account #'] ?? '').trim()
    const a = { name, code, type: mapped[0], subtype, detail: r.cells['detail type'] ?? '', description: r.cells['description'] ?? '' }
    accountNames.set(name.toLowerCase(), a)
    if (code) accountNames.set(`${code} ${name}`.toLowerCase(), a)
    return a
  }, () => r.cells['full name'] ?? r.cells['account'])

  const contacts = (file: 'customers' | 'vendors', kind: 'customer' | 'vendor') => {
    const rep = report(p.files[file].content, [kind], LABELS[file])
    const names = new Set<string>()
    for (const r of rep.rows) attempt(kind, file, r.row, () => {
      const name = text(r.cells[kind], `${kind} name`, 200)
      requireThat(!names.has(name.toLowerCase()), `${name} appears twice`)
      names.add(name.toLowerCase())
      const email = (r.cells['email'] ?? '').split(/[;,]/)[0].trim().toLowerCase()
      return { name, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '' }
    }, () => r.cells[kind])
    return names
  }
  const customers = contacts('customers', 'customer'), vendors = contacts('vendors', 'vendor')

  const tb = report(p.files.trialBalance.content, ['debit', 'credit'], 'Trial Balance')
  const cutoverDate = p.cutoverDate ? date(p.cutoverDate, 'Cutover date') : asOf(tb.title)
  requireThat(cutoverDate, 'The Trial Balance names no "As of" date; enter the cutover date')
  const tbRows: TbRow[] = []
  for (const r of tb.rows) {
    const name = (r.cells[tb.header[0]] ?? '').trim() || r.group
    try {
      const account = accountNames.get(name.toLowerCase())
      requireThat(account, `Trial balance account "${name}" is not in the Account List`)
      const debit = amount(r.cells['debit'] ?? '', 'Debit'), credit = amount(r.cells['credit'] ?? '', 'Credit')
      requireThat(debit >= 0 && credit >= 0 && (debit === 0 || credit === 0), 'A trial balance row has a debit or a credit')
      if (debit || credit) tbRows.push({ account: account.name, debit, credit, row: r.row })
    } catch (e) { refuse('trial-balance', 'trialBalance', r.row, (e as Error).message, { account: name }) }
  }

  const items = (file: 'openInvoices' | 'unpaidBills', kind: 'invoice' | 'bill', known: Set<string>) => {
    const rep = report(p.files[file].content, ['date', 'num', 'open balance'], LABELS[file])
    for (const r of rep.rows) attempt(kind, file, r.row, () => {
      const party = r.group || r.cells['customer'] || r.cells['vendor']
      requireThat(party && known.has(party.toLowerCase()), `${kind === 'invoice' ? 'Customer' : 'Vendor'} "${party}" is not in the contact list`)
      const num = text(r.cells['num'], `${kind === 'invoice' ? 'Invoice' : 'Bill'} number`, 80)
      const open = amount(r.cells['open balance'], 'Open balance'), original = amount(r.cells['amount'] ?? r.cells['open balance'], 'Amount')
      requireThat(open > 0, 'Open balance must be positive (credits are not imported as open items)')
      const day = usDate(r.cells['date'], 'Date')
      requireThat(day <= cutoverDate, `Dated after the cutover date ${cutoverDate}`)
      return { party, num, date: day, due: r.cells['due date'] ? usDate(r.cells['due date'], 'Due date') : day, open, original }
    }, () => `${r.group}|${r.cells['num']}`)
  }
  items('openInvoices', 'invoice', customers)
  items('unpaidBills', 'bill', vendors)

  bankRecords(c, p.banks, accountNames, 'QuickBooks Online')

  const gl = report(p.files.generalLedger.content, ['date', 'transaction type', 'amount'], 'General Ledger')
  let history = 0
  for (const r of gl.rows) {
    if (/beginning balance/i.test(r.cells['date'] ?? '') || (!r.cells['date'] && !r.cells['amount'])) continue
    history++
    attempt('history', 'generalLedger', r.row, () => ({
      account: text(r.group, 'Account heading', 200), date: usDate(r.cells['date'], 'Date'), type: r.cells['transaction type'] ?? '', num: r.cells['num'] ?? '',
      name: r.cells['name'] ?? '', memo: r.cells['memo/description'] ?? '', split: r.cells['split'] ?? '', amount: amount(r.cells['amount'], 'Amount'), row: r.row,
    }), () => String(r.row))
  }
  c.out.push({ kind: 'cutover', sourceId: cutoverDate, payload: { date: cutoverDate, rows: tbRows }, artifact: 'trialBalance', row: 0 })
  return { list: c.out, cutoverDate, tbRows, accountNames, extraChecks: [], notImported: [
    { what: 'General ledger transactions as ledger entries', count: history, why: 'They come in as read-only history lines for reference; the trial balance carries their effect, so posting them again would count them twice.' },
    { what: 'Attachments', count: 0, why: 'Review the separate attachment archive in Document archive originals; files without exact source matches wait for owner placement.' },
  ] }
}

export const quickbooks: Source = {
  key: 'quickbooks-online', name: 'QuickBooks Online', prefix: 'qbo', namespace: 'qbo-cutover', files: FILES, labels: LABELS, parse,
  missingDocuments: n => `${n} open invoices and bills need their source originals. Review a separate attachment archive in Document archive originals, or upload files in Documents.`,
}
