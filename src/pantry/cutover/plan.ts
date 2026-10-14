// The QuickBooks Online cutover package → reviewed import records and their
// tie-out checks. Every row becomes one record: accepted rows map to one native
// entity each, refused rows stay in the plan with their reason.
import { canonicalJson, sha256, type SourceBundle, type SourceRecord, type ImportMapping } from '../../modules/import-kit/src/d1/index'
import { cents, date, requireThat, text, usd, type Data } from '../core'
import { ACCOUNT_TYPES, amount, asOf, qboDate, report } from './qbo'

export const NAMESPACE = 'qbo-cutover'
export const FILES = ['accounts', 'customers', 'vendors', 'trialBalance', 'openInvoices', 'unpaidBills', 'generalLedger'] as const
type FileKey = typeof FILES[number]
export type Package = { files: Record<FileKey, { name: string; content: string }>; banks: Data[]; cutoverDate?: string }

const key = (s: string) => sha256(s.trim().toLowerCase()).slice(0, 20)
export const ids = {
  account: (name: string) => `qbo-account-${key(name)}`,
  contact: (kind: string, name: string) => `qbo-${kind}-${key(name)}`,
  bank: (name: string) => `qbo-bank-${key(name)}`,
  invoice: (num: string) => `qbo-invoice-${key(num)}`,
  bill: (vendor: string, num: string) => `qbo-bill-${key(vendor + '|' + num)}`,
  cutover: (day: string) => `qbo-cutover-${day}`,
  history: (row: number) => `qbo-history-${row}`,
}

type Rec = { kind: string; sourceId: string; payload: Data; artifact: string; row: number }

export function readPackage(b: Data): Package {
  requireThat(b.files && typeof b.files === 'object', 'Upload the QuickBooks Online export files')
  const files = {} as Package['files']
  for (const f of FILES) {
    const file = b.files[f]
    requireThat(file && typeof file.content === 'string' && file.content.length > 0 && file.content.length <= 2_000_000, `Upload the ${LABELS[f]} export (CSV, up to 2 MB)`)
    files[f] = { name: text(file.name ?? `${f}.csv`, 'File name', 200), content: file.content }
  }
  return { files, banks: Array.isArray(b.banks) ? b.banks : [], cutoverDate: b.cutoverDate }
}

export const LABELS: Record<FileKey, string> = { accounts: 'Account List', customers: 'Customer Contact List', vendors: 'Vendor Contact List', trialBalance: 'Trial Balance', openInvoices: 'Open Invoices', unpaidBills: 'Unpaid Bills', generalLedger: 'General Ledger' }

/** Parse every file into records; row-level problems become refusals, not exceptions. */
export function records(p: Package) {
  const out: Rec[] = []
  const refuse = (kind: string, artifact: string, row: number, reason: string, payload: Data = {}) => out.push({ kind, sourceId: `${artifact}:${row}`, payload: { ...payload, refused: reason }, artifact, row })
  const attempt = (kind: string, artifact: string, row: number, build: () => Data, sourceId: () => string) => {
    try { const payload = build(); out.push({ kind, sourceId: sourceId(), payload, artifact, row }) } catch (e) { refuse(kind, artifact, row, (e as Error).message) }
  }

  const accounts = report(p.files.accounts.content, ['type', 'detail type'], 'Account List')
  const accountNames = new Map<string, Data>()
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
  const tbRows: Data[] = []
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
      const day = qboDate(r.cells['date'], 'Date')
      requireThat(day <= cutoverDate, `Dated after the cutover date ${cutoverDate}`)
      return { party, num, date: day, due: r.cells['due date'] ? qboDate(r.cells['due date'], 'Due date') : day, open, original }
    }, () => `${r.group}|${r.cells['num']}`)
  }
  items('openInvoices', 'invoice', customers)
  items('unpaidBills', 'bill', vendors)

  for (const [i, b] of p.banks.entries()) attempt('bank', 'banks', i + 1, () => {
    const name = text(b.account, 'Bank account (QuickBooks name)', 200)
    const account = accountNames.get(name.toLowerCase())
    requireThat(account && account.subtype === 'bank', `"${name}" is not a Bank account in the Account List`)
    const last4 = text(b.last4, 'Last four digits', 4)
    requireThat(/^\d{4}$/.test(last4), 'Enter the last four digits of the account number')
    return { account: account.name, institution: text(b.institution, 'Bank', 120), last4, statementBalance: cents(b.statementBalance, 'Reconciled statement balance at cutover', { signed: true, zero: true }) }
  }, () => b.account)

  const gl = report(p.files.generalLedger.content, ['date', 'transaction type', 'amount'], 'General Ledger')
  for (const r of gl.rows) {
    if (/beginning balance/i.test(r.cells['date'] ?? '') || (!r.cells['date'] && !r.cells['amount'])) continue
    attempt('history', 'generalLedger', r.row, () => ({
      account: text(r.group, 'Account heading', 200), date: qboDate(r.cells['date'], 'Date'), type: r.cells['transaction type'] ?? '', num: r.cells['num'] ?? '',
      name: r.cells['name'] ?? '', memo: r.cells['memo/description'] ?? '', split: r.cells['split'] ?? '', amount: amount(r.cells['amount'], 'Amount'), row: r.row,
    }), () => String(r.row))
  }
  out.push({ kind: 'cutover', sourceId: cutoverDate, payload: { date: cutoverDate, rows: tbRows }, artifact: 'trialBalance', row: 0 })
  return { list: out, cutoverDate, tbRows, accountNames }
}

export type Checks = { key: string; title: string; ok: boolean; detail: string }[]

/** Tie-outs a person and accountant review before anything is committed. */
export function checks(r: ReturnType<typeof records>): Checks {
  const ok = (kind: string) => r.list.filter(x => x.kind === kind && !x.payload.refused)
  const debit = r.tbRows.reduce((s, x) => s + x.debit, 0), credit = r.tbRows.reduce((s, x) => s + x.credit, 0)
  const tbNet = (subtype: string) => r.tbRows.filter(x => r.accountNames.get(x.account.toLowerCase())?.subtype === subtype).reduce((s, x) => s + x.debit - x.credit, 0)
  const invoices = ok('invoice').reduce((s, x) => s + x.payload.open, 0), bills = ok('bill').reduce((s, x) => s + x.payload.open, 0)
  const ar = tbNet('receivable'), ap = -tbNet('payable')
  const out: Checks = [
    { key: 'tb', title: 'Trial balance balances', ok: debit === credit && debit > 0, detail: `Debits ${usd(debit)}, credits ${usd(credit)}` },
    { key: 'ar', title: 'Open invoices equal receivables', ok: invoices === ar, detail: `Open invoices ${usd(invoices)}; trial balance receivables ${usd(ar)}` },
    { key: 'ap', title: 'Unpaid bills equal payables', ok: bills === ap, detail: `Unpaid bills ${usd(bills)}; trial balance payables ${usd(ap)}` },
  ]
  const tbBanks = r.tbRows.filter(x => r.accountNames.get(x.account.toLowerCase())?.subtype === 'bank')
  for (const t of tbBanks) {
    const b = ok('bank').find(x => x.payload.account === t.account)
    out.push({ key: `bank:${t.account}`, title: `${t.account} agrees to its reconciled statement`, ok: !!b && b.payload.statementBalance === t.debit - t.credit,
      detail: b ? `Statement ${usd(b.payload.statementBalance)}; trial balance ${usd(t.debit - t.credit)}` : 'Enter this account\'s bank, last four digits and reconciled statement balance at cutover' })
  }
  const roles = [...r.accountNames.values()]
  const single = (subtype: string) => new Set(roles.filter(a => a.subtype === subtype).map(a => a.name)).size
  out.push({ key: 'controls', title: 'One receivable and one payable account', ok: single('receivable') <= 1 && single('payable') <= 1 && (invoices === 0 || single('receivable') === 1) && (bills === 0 || single('payable') === 1), detail: `${single('receivable')} receivable, ${single('payable')} payable` })
  return out
}

/** Records into the kit's source bundle, with the exact uploaded bytes as artifacts. */
export function bundle(p: Package, list: Rec[]): SourceBundle {
  // The bank details typed at review are an input too, kept beside the export files.
  const inputs = [...FILES.map(f => ({ key: f as string, name: p.files[f].name, bytes: new TextEncoder().encode(p.files[f].content) })),
    { key: 'banks', name: 'bank-details-entered-at-review.json', bytes: new TextEncoder().encode(canonicalJson(p.banks as any)) }]
  const artifacts = inputs.map(a => ({ ...a, sha256: sha256(a.bytes), base64: btoa(Array.from(a.bytes, x => String.fromCharCode(x)).join('')) }))
  const by = Object.fromEntries(artifacts.map(a => [a.key, a]))
  const order = ['account', 'customer', 'vendor', 'bank', 'invoice', 'bill', 'trial-balance', 'cutover', 'history']
  const records: SourceRecord[] = [...list].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).map(r => ({
    namespace: NAMESPACE, kind: r.kind, sourceId: r.sourceId, payload: r.payload as any, payloadHash: sha256(canonicalJson(r.payload as any)),
    artifactHash: by[r.artifact].sha256, location: { artifact: by[r.artifact].name, row: r.row } as any,
  }))
  return { records, diagnostics: [], artifacts: artifacts.map(a => ({ name: a.name, sha256: a.sha256, size: a.bytes.length, original: { status: 'available' as const, base64: a.base64 } })) }
}

/** Native values: exactly the columns the target adapter reads back. */
export function mapping(p: Package, r: ReturnType<typeof records>, preparedBy: string): ImportMapping {
  const day = r.cutoverDate, version = `qbo-cutover-v1:${day}`
  const code = new Map<string, string>(), used = new Set<string>()
  const prefix: Record<string, number> = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 6000 }
  for (const a of [...r.accountNames.values()]) {
    if (code.has(a.name)) continue
    let c = a.code
    if (!c || used.has(c)) { let n = prefix[a.type]; while (used.has(String(n))) n += 10; c = String(n); prefix[a.type] = n + 10 }
    used.add(c); code.set(a.name, c)
  }
  const accountId = (name: string) => ids.account(name)
  return { version, map(rec) {
    const x = rec.payload as Data
    if (x.refused) return { effects: [], rejection: x.refused }
    if (rec.kind === 'account') return { effects: [{ targetKind: 'chart', targetId: ids.account(x.name), value: { code: code.get(x.name)!, name: x.name, type: x.type, subtype: x.subtype, description: x.description || x.detail, active: 1 } }] }
    if (rec.kind === 'customer' || rec.kind === 'vendor') return { effects: [{ targetKind: 'counterparty', targetId: ids.contact(rec.kind, x.name), value: { kind: rec.kind, name: x.name, email: x.email, terms_days: 30, external_ref: 'QuickBooks Online', active: 1 } }] }
    if (rec.kind === 'bank') return { effects: [{ targetKind: 'bank', targetId: ids.bank(x.account), value: { name: x.account, account_id: accountId(x.account), institution: x.institution, number_last4: x.last4, routing: '', opening_date: day, opening_cents: x.statementBalance } }] }
    if (rec.kind === 'invoice') return { effects: [{ targetKind: 'invoice', targetId: ids.invoice(x.num), value: { kind: 'invoice', number: x.num, customer_id: ids.contact('customer', x.party), issue_date: x.date, due_date: x.due, status: 'issued', memo: `Opening item from QuickBooks Online; original amount ${usd(x.original)}`, credit_for: null, subtotal_cents: x.open, tax_cents: 0, total_cents: x.open, opening: 1, journal_id: null, prepared_by: preparedBy, approved_by: null, approved_revision: null, issued_by: null, created_at: day } }] }
    if (rec.kind === 'bill') return { effects: [{ targetKind: 'bill', targetId: ids.bill(x.party, x.num), value: { vendor_id: ids.contact('vendor', x.party), reference: x.num, bill_date: x.date, due_date: x.due, status: 'posted', memo: `Opening item from QuickBooks Online; original amount ${usd(x.original)}`, total_cents: x.open, opening: 1, evidence_waived: null, journal_id: null, prepared_by: preparedBy, created_at: day } }] }
    if (rec.kind === 'cutover') {
      const entryId = `${ids.cutover(day)}-entry`
      return { effects: [{ targetKind: 'cutover', targetId: ids.cutover(day), value: {
        cutover: { source: 'quickbooks-online', cutover_date: day, opening_entry_id: entryId, summary: `Opening balances from the QuickBooks Online trial balance as of ${day}`, status: 'staged', accepted_by: null, accepted_at: null },
        entry: { id: entryId, number: null, entry_date: day, memo: `Opening balances — QuickBooks Online trial balance as of ${day}`, source_kind: 'opening', source_id: ids.cutover(day), status: 'draft', prepared_by: preparedBy, prepared_kind: 'import', proposal_id: null, document_id: null, posted_by: null, posted_at: null, reverses_id: null, reversed_by_id: null, created_at: day },
        lines: x.rows.map((t: Data, i: number) => ({ line_no: i + 1, account_id: accountId(t.account), debit_cents: t.debit, credit_cents: t.credit, memo: 'Opening balance', contact_id: null })),
      } }] }
    }
    if (rec.kind === 'history') return { effects: [{ targetKind: 'history', targetId: ids.history(x.row), value: { cutover_id: ids.cutover(day), account: x.account, txn_date: x.date, txn_type: x.type, num: x.num, name: x.name, memo: x.memo, split: x.split, amount_cents: x.amount, source_row: x.row } }] }
    return { effects: [], rejection: `Unknown record ${rec.kind}` }
  } }
}
