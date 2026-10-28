// Xero's standard exports: the chart of accounts and contacts (CSV exports),
// all sales invoices and all bills (CSV exports, one row per line item), and
// the Trial Balance and Account Transactions reports saved as CSV. Each row is
// parsed into one import record. See MOVE-IN.md.
import { date, requireThat, text, usd } from '../core'
import type { Checks } from './plan'
import { amount, asOf, exportDate, periodEnd, report as readReport, type Row } from './report'
import { bankRecords, collector, type Account, type Left, type Package, type Parsed, type Source, type TbRow } from './source'

const FILES = ['accounts', 'contacts', 'trialBalance', 'invoices', 'bills', 'bankTransactions'] as const
const LABELS: Record<string, string> = { accounts: 'Chart of accounts', contacts: 'Contacts', trialBalance: 'Trial Balance', invoices: 'Sales invoices', bills: 'Bills', bankTransactions: 'Account Transactions (bank accounts)' }
const report = (source: string, required: string[], label: string) => readReport(source, required, label, 'Export it from Xero unchanged (reports: export to Excel, then save the sheet as CSV).')

/** Xero account types (as its chart export names them, system accounts included) → Pantry type and role. */
const XERO_TYPES: Record<string, [string, string]> = {
  'bank': ['asset', 'bank'],
  'accounts receivable': ['asset', 'receivable'],
  'current asset': ['asset', 'other'], 'fixed asset': ['asset', 'other'], 'non-current asset': ['asset', 'other'], 'inventory': ['asset', 'other'], 'prepayment': ['asset', 'other'],
  'accounts payable': ['liability', 'payable'],
  'current liability': ['liability', 'other'], 'liability': ['liability', 'other'], 'non-current liability': ['liability', 'other'], 'credit card': ['liability', 'other'],
  'wages payable': ['liability', 'other'], 'unpaid expense claims': ['liability', 'other'], 'historical adjustment': ['liability', 'other'], 'rounding': ['liability', 'other'], 'tracking transfers': ['liability', 'other'],
  'sales tax': ['liability', 'tax'],
  'equity': ['equity', 'other'], 'retained earnings': ['equity', 'retained'],
  'revenue': ['income', 'other'], 'sales': ['income', 'other'], 'other income': ['income', 'other'],
  'expense': ['expense', 'other'], 'direct costs': ['expense', 'other'], 'overhead': ['expense', 'other'], 'depreciation': ['expense', 'other'],
}
/** Xero's system accounts keep these names unless renamed; an export that shows only their broad type still gets the control role. */
const SYSTEM: Record<string, [string, string]> = { 'accounts receivable': ['current asset', 'receivable'], 'accounts payable': ['current liability', 'payable'], 'retained earnings': ['equity', 'retained'], 'sales tax': ['current liability', 'tax'] }

type Status = 'open' | 'paid' | 'draft' | 'voided'
const STATUS: Record<string, Status> = { 'awaiting payment': 'open', 'authorised': 'open', 'paid': 'paid', 'draft': 'draft', 'awaiting approval': 'draft', 'submitted': 'draft', 'voided': 'voided', 'deleted': 'voided' }
type Doc = { key: string; party: string; num: string; rows: Row[]; first: Row }

/** One invoice or bill per document: line rows grouped by number (and supplier, for bills). */
function documents(rows: Row[], bills: boolean): Doc[] {
  const by = new Map<string, Doc>()
  for (const r of rows) {
    const party = r.cells['contactname'] ?? '', num = r.cells['invoicenumber'] ?? ''
    // A bill's number is optional in Xero; one without is told apart by its date and total.
    const key = bills ? `${party.toLowerCase()}|${num || `${r.cells['invoicedate']}|${r.cells['total']}`}` : num.toLowerCase()
    const d = by.get(key) ?? { key, party, num, rows: [], first: r }
    d.rows.push(r); by.set(key, d)
  }
  return [...by.values()]
}

function parse(p: Package): Parsed {
  const c = collector(), { attempt, refuse } = c
  const left: Left[] = []
  const leave = (what: string, count: number, why: string) => { if (count) left.push({ what, count, why }) }

  const chart = report(p.files.accounts.content, ['code', 'name', 'type'], 'Chart of accounts')
  const accountNames = new Map<string, Account>(), byCode = new Map<string, Account>()
  for (const r of chart.rows) attempt('account', 'accounts', r.row, () => {
    const name = text(r.cells['name'], 'Account name', 200), code = (r.cells['code'] ?? '').trim(), type = (r.cells['type'] ?? '').trim().toLowerCase()
    const system = Object.hasOwn(SYSTEM, name.toLowerCase()) ? SYSTEM[name.toLowerCase()] : undefined
    const accountType = Object.hasOwn(XERO_TYPES, type) ? XERO_TYPES[type] : undefined
    const mapped = accountType && system && system[0] === type ? [accountType[0], system[1]] : accountType
    requireThat(mapped, `Account type "${r.cells['type']}" is not a Xero account type Pantry maps`)
    const a = { name, code, type: mapped[0], subtype: mapped[1], detail: r.cells['type'], description: r.cells['description'] ?? '' }
    accountNames.set(name.toLowerCase(), a)
    if (code) { byCode.set(code.toLowerCase(), a); accountNames.set(`${name} (${code})`.toLowerCase(), a) }
    return a
  }, () => r.cells['code'] || r.cells['name'])
  /** "Sales (400)", a bare name, or a code column: the account a report row names. */
  const lookup = (label: string, code = '') => {
    const m = /^(.*) \(([^()]+)\)$/.exec(label.trim())
    return byCode.get((code || m?.[2] || '').toLowerCase()) ?? accountNames.get(label.trim().toLowerCase()) ?? (m ? accountNames.get(m[1].toLowerCase()) : undefined)
  }

  const tb = report(p.files.trialBalance.content, ['debit', 'credit'], 'Trial Balance')
  const cutoverDate = p.cutoverDate ? date(p.cutoverDate, 'Cutover date') : asOf(tb.title)
  requireThat(cutoverDate, 'The Trial Balance names no "As at" date; enter the cutover date')
  const tbRows: TbRow[] = []
  const nameColumn = tb.header.includes('account') ? 'account' : tb.header[0]
  for (const r of tb.rows) {
    const name = (r.cells[nameColumn] ?? '').trim() || r.group
    try {
      const account = lookup(name, r.cells['account code'])
      requireThat(account, `Trial balance account "${name}" is not in the chart of accounts`)
      const debit = amount(r.cells['debit'] ?? '', 'Debit'), credit = amount(r.cells['credit'] ?? '', 'Credit')
      requireThat(debit >= 0 && credit >= 0 && (debit === 0 || credit === 0), 'A trial balance row has a debit or a credit')
      if (debit || credit) tbRows.push({ account: account.name, debit, credit, row: r.row })
    } catch (e) { refuse('trial-balance', 'trialBalance', r.row, (e as Error).message, { account: name }) }
  }

  // Invoices and bills first: Xero counts a contact as a customer or supplier by the documents that name it.
  const contactRows = report(p.files.contacts.content, ['contactname'], 'Contacts')
  const known = new Set(contactRows.rows.map(r => (r.cells['contactname'] ?? '').trim().toLowerCase()))
  const used = { customer: new Set<string>(), vendor: new Set<string>() }
  const items = (file: 'invoices' | 'bills', kind: 'invoice' | 'bill') => {
    const what = kind === 'invoice' ? 'invoices' : 'bills'
    const rep = report(p.files[file].content, ['contactname', 'invoicenumber', 'invoicedate'], LABELS[file])
    const count: Record<string, number> = { paid: 0, draft: 0, voided: 0, after: 0, credits: 0 }
    for (const d of documents(rep.rows, kind === 'bill')) attempt(kind, file, d.first.row, () => {
      const cell = (k: string) => d.first.cells[k] ?? ''
      requireThat(d.party, `${kind === 'invoice' ? 'Invoice' : 'Bill'} on row ${d.first.row} names no contact`)
      for (const r of d.rows) for (const k of ['contactname', 'invoicedate', 'duedate', 'total', 'invoiceamountdue', 'status', 'type'])
        requireThat((r.cells[k] ?? '') === cell(k), `Row ${r.row} disagrees with row ${d.first.row} of the same ${kind} on ${k}`)
      used[kind === 'invoice' ? 'customer' : 'vendor'].add(d.party.toLowerCase())
      const statusName = cell('status').toLowerCase()
      const status = Object.hasOwn(STATUS, statusName) ? STATUS[statusName] : undefined
      requireThat(status, `Status "${cell('status')}" is not a Xero ${kind} status`)
      const day = exportDate(cell('invoicedate'), 'Date'), due = amount(cell('invoiceamountdue'), 'Amount due'), total = amount(cell('total'), 'Total')
      if (/credit/i.test(cell('type'))) {
        requireThat(!(status === 'open' && due > 0 && day <= cutoverDate), `Credit note ${d.num} has ${usd(due)} of credit left; apply or refund it in Xero before the cutover date (credits are not brought in as open items)`)
        count.credits++; return { skip: 'credit' }
      }
      if (status !== 'open' || due === 0) { count[status === 'open' ? 'paid' : status]++; return { skip: status } }
      if (day > cutoverDate) { count.after++; return { skip: 'after' } }
      requireThat(known.has(d.party.toLowerCase()), `Contact "${d.party}" is not in the Contacts export`)
      requireThat(due > 0 && due <= total, `Amount due ${usd(due)} must be above zero and at most the total ${usd(total)}`)
      const num = text(d.num || `${day} ${usd(total)}`, `${kind === 'invoice' ? 'Invoice' : 'Bill'} number`, 80)
      return { party: d.party, num, date: day, due: cell('duedate') ? exportDate(cell('duedate'), 'Due date') : day, open: due, original: total }
    }, () => d.key)
    leave(`Paid ${what}`, count.paid, 'Settled before you moved; their effect is in the trial balance, and they stay in Xero.')
    leave(`Draft ${what}`, count.draft, 'Never approved in Xero, so not in its books; create any you still need in Pantry.')
    leave(`Voided ${what}`, count.voided, 'Voided or deleted in Xero.')
    leave(`${what[0].toUpperCase()}${what.slice(1)} dated after the cutover date`, count.after, 'Not part of the books at cutover; enter them in Pantry.')
    leave(`Credit notes on ${what}`, count.credits, 'Fully applied or refunded in Xero; their effect is in the trial balance.')
  }
  items('invoices', 'invoice')
  items('bills', 'bill')
  // An entry from the loops above that is not an open item leaves the plan: it was only read for counts and contact roles.
  for (let i = c.out.length - 1; i >= 0; i--) if (c.out[i].payload.skip) c.out.splice(i, 1)

  const names = new Set<string>()
  let unused = 0
  for (const r of contactRows.rows) {
    const name = (r.cells['contactname'] ?? '').trim(), email = (r.cells['emailaddress'] ?? '').trim().toLowerCase()
    if (!name) { refuse('customer', 'contacts', r.row, 'Contact name is required'); continue }
    if (names.has(name.toLowerCase())) { refuse('customer', 'contacts', r.row, `${name} appears twice`); continue }
    names.add(name.toLowerCase())
    const kinds = (['customer', 'vendor'] as const).filter(k => used[k].has(name.toLowerCase()))
    if (!kinds.length) unused++
    for (const kind of kinds) c.out.push({ kind, sourceId: name, payload: { name, email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '' }, artifact: 'contacts', row: r.row })
  }
  leave('Contacts on no invoice or bill', unused, 'Xero makes a contact a customer or supplier only once an invoice or bill names them; add them in Pantry when you first need them.')

  bankRecords(c, p.banks, accountNames, 'Xero')

  // Account Transactions: per account, an opening balance, its lines, and a closing balance that must meet the trial balance.
  const at = report(p.files.bankTransactions.content, ['date', 'debit', 'credit'], 'Account Transactions')
  const end = periodEnd(at.title)
  const flow = new Map<string, { opening: number; moves: number; closing: number | null; lines: number }>()
  let history = 0
  for (const r of at.rows) {
    const account = lookup(r.group)
    const label = (r.cells['date'] || r.cells['source'] || '').toLowerCase()
    const balance = () => r.cells['running balance'] ? amount(r.cells['running balance'], 'Running balance') : amount(r.cells['debit'] ?? '', 'Debit') - amount(r.cells['credit'] ?? '', 'Credit')
    if (!account) { refuse('history', 'bankTransactions', r.row, `Account heading "${r.group}" is not in the chart of accounts`); continue }
    const f = flow.get(account.name) ?? { opening: 0, moves: 0, closing: null, lines: 0 }
    flow.set(account.name, f)
    try {
      if (label === 'opening balance') { f.opening = balance(); continue }
      if (label === 'closing balance') { f.closing = balance(); continue }
    } catch (e) { refuse('history', 'bankTransactions', r.row, (e as Error).message); continue }
    history++
    attempt('history', 'bankTransactions', r.row, () => {
      const value = amount(r.cells['debit'] ?? '', 'Debit') - amount(r.cells['credit'] ?? '', 'Credit')
      f.moves += value; f.lines++
      return { account: account.name, date: exportDate(r.cells['date'], 'Date'), type: r.cells['source'] ?? '', num: r.cells['reference'] ?? '', name: r.cells['description'] ?? '', memo: '', split: '', amount: value, row: r.row }
    }, () => String(r.row))
  }
  const extraChecks: Checks = []
  for (const t of tbRows.filter(x => accountNames.get(x.account.toLowerCase())?.subtype === 'bank')) {
    const f = flow.get(t.account), book = t.debit - t.credit
    const reaches = f ? f.opening + f.moves : 0
    const ok = !!f && reaches === book && (f.closing === null || f.closing === book) && end === cutoverDate
    extraChecks.push({ key: `history:${t.account}`, title: `${t.account} transactions run to its trial balance`, ok,
      detail: !f ? 'Include this account in the Account Transactions export'
        : end !== cutoverDate ? `The export runs to ${end ?? 'no date'}; run it to the cutover date ${cutoverDate}`
        : `Opening ${usd(f.opening)} + ${f.lines} ${f.lines === 1 ? 'line' : 'lines'} ${usd(f.moves)} = ${usd(reaches)}${f.closing === null ? '' : `; closing ${usd(f.closing)}`}; trial balance ${usd(book)}` })
  }
  leave('Bank transactions as ledger entries', history, 'They come in as read-only history lines for reference; the trial balance carries their effect, so posting them again would count them twice.')
  left.push({ what: 'Attachments', count: 0, why: 'Xero’s exports carry none. After importing, connect Xero to bring over the files on open invoices and bills.' })

  c.out.push({ kind: 'cutover', sourceId: cutoverDate, payload: { date: cutoverDate, rows: tbRows }, artifact: 'trialBalance', row: 0 })
  return { list: c.out, cutoverDate, tbRows, accountNames, extraChecks, notImported: left }
}

export const xero: Source = {
  key: 'xero', name: 'Xero', prefix: 'xero', namespace: 'xero-cutover', files: FILES, labels: LABELS, parse,
  missingDocuments: n => `Xero’s exports carry no attachments: ${n} open invoices and bills arrive without their files. After importing, connect Xero to carry their attachments over, or upload them in Documents.`,
}
