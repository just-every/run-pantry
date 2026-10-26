// Intuit JSON retains provider identities, rather than matching transaction numbers.
import { date, requireThat, text, type Data } from '../core'
import { amount } from './report'
import { bankRecords, collector, type Account, type Package, type Parsed, type TbRow } from './source'

const TYPES: Record<string, [string, string]> = {
 Bank: ['asset', 'bank'], AccountsReceivable: ['asset', 'receivable'], OtherCurrentAsset: ['asset', 'other'], FixedAsset: ['asset', 'other'], OtherAsset: ['asset', 'other'],
 AccountsPayable: ['liability', 'payable'], CreditCard: ['liability', 'other'], OtherCurrentLiability: ['liability', 'other'], LongTermLiability: ['liability', 'other'],
 Equity: ['equity', 'other'], Income: ['income', 'other'], OtherIncome: ['income', 'other'], CostofGoodsSold: ['expense', 'other'], Expense: ['expense', 'other'], OtherExpense: ['expense', 'other'],
}
// Intuit report decimals may omit the zero before the decimal point.
const money = (value: unknown, label: string) => amount(String(value ?? '').replace(/^(-?)\./, '$10.'), label)
export function qboReportRows(report: Data): Data[] {
  const rows: Data[] = []
  const walk = (list: Data[], group = '') => {
    for (const row of list) {
      const heading = row.Header?.ColData?.[0]?.value ?? group
      if (row.ColData) rows.push({ ...row, group })
      if (row.Rows?.Row) walk(row.Rows.Row, heading)
    }
  }
  walk(report.Rows?.Row ?? [])
  return rows
}
export function parseQboSnapshot(p: Package): Parsed {
  let s: Data
  try { s = JSON.parse(p.files.apiSnapshot.content) } catch { throw new Error('The QuickBooks API snapshot is invalid JSON') }
  requireThat(s.format === 'pantry-qbo-read-1', 'Choose a Pantry QuickBooks API snapshot')
  const cutoverDate = date(s.to, 'Cutover date'), from = date(s.from, 'History start')
  requireThat(from <= cutoverDate && (!p.cutoverDate || p.cutoverDate === cutoverDate), 'The snapshot dates do not match the cutover')
  for (const k of ['Account', 'Customer', 'Vendor', 'Invoice', 'Bill', 'Attachable']) requireThat(Array.isArray(s[k]), `The snapshot is missing ${k} pages`)
  const c = collector(), accountNames = new Map<string, Account>(), byId = new Map<string, Account>(), contacts = { invoice: new Map<string, string>(), bill: new Map<string, string>() }
  let row = 0
  const add = (kind: string, sourceId: string, build: () => Data) => c.attempt(kind, 'apiSnapshot', ++row, build, () => sourceId)
  const seen = new Set<string>()
  for (const a of s.Account) add('account', text(a.Id, 'Account source ID'), () => {
    const mapped = TYPES[String(a.AccountType).replace(/\s+/g, '')], name = text(a.FullyQualifiedName ?? a.Name, 'Account name', 200)
    requireThat(mapped, `Unsupported Intuit account type ${a.AccountType}`)
    requireThat(!accountNames.has(name.toLowerCase()), `Duplicate account name ${name}`)
    const account = { name, code: a.AcctNum ?? '', type: mapped[0], subtype: a.AccountSubType === 'RetainedEarnings' ? 'retained' : a.AccountSubType === 'GlobalTaxPayable' ? 'tax' : mapped[1], detail: a.AccountSubType ?? '', description: a.Description ?? '' }
    accountNames.set(name.toLowerCase(), account); byId.set(a.Id, account)
    return account
  })
  for (const [resource, kind] of [['Customer', 'customer'], ['Vendor', 'vendor']] as const) for (const party of s[resource]) add(kind, text(party.Id, 'Contact source ID'), () => {
    const name = text(party.DisplayName, 'Contact name', 200), key = `${kind}:${name.toLowerCase()}`
    requireThat(!seen.has(key), `Duplicate ${kind} name ${name}`); seen.add(key)
    contacts[kind === 'customer' ? 'invoice' : 'bill'].set(party.Id, name)
    return { name, email: party.PrimaryEmailAddr?.Address ?? '' }
  })
  const report = s.TrialBalance
  requireThat(report?.Header?.EndPeriod === cutoverDate && report?.Header?.ReportBasis === 'Accrual' && report?.Header?.Currency === 'USD', 'Trial balance must be USD accrual at the cutover date')
  const columns = report.Columns?.Column ?? [], debitAt = columns.findIndex((v: Data) => v.ColTitle === 'Debit'), creditAt = columns.findIndex((v: Data) => v.ColTitle === 'Credit')
  requireThat(debitAt >= 0 && creditAt >= 0, 'Intuit trial balance has no debit and credit columns')
  const tbRows: TbRow[] = []
  for (const r of qboReportRows(report)) {
    const cells = r.ColData, a = byId.get(cells[0]?.id)
    if (!a) { c.refuse('trial-balance', 'apiSnapshot', ++row, 'Trial balance account ID is not in the chart'); continue }
    const debit = money(cells[debitAt]?.value, 'Trial balance debit'), credit = money(cells[creditAt]?.value, 'Trial balance credit')
    requireThat(debit >= 0 && credit >= 0 && (!debit || !credit), 'Invalid Intuit trial balance row')
    if (debit || credit) tbRows.push({ account: a.name, debit, credit, row: ++row })
  }
  for (const [resource, kind] of [['Invoice', 'invoice'], ['Bill', 'bill']] as const) for (const item of s[resource]) {
    const open = amount(String(item.Balance ?? 0), 'Open balance')
    if (!open) continue
    add(kind, text(item.Id, 'Transaction source ID'), () => {
      const party = contacts[kind].get((kind === 'invoice' ? item.CustomerRef : item.VendorRef)?.value)
      requireThat(party, 'The transaction contact ID is missing')
      const day = date(item.TxnDate, 'Transaction date')
      requireThat(day <= cutoverDate, 'Open transaction is after the cutover date; use current reports and an agreed cutover')
      requireThat(open > 0, 'An unapplied credit needs an explicit opening-credit migration')
      return { party, num: text(item.DocNumber || `Intuit ${item.Id}`, 'Transaction number', 80), date: day, due: date(item.DueDate ?? day, 'Due date'), open, original: amount(String(item.TotalAmt), 'Original total') }
    })
  }
  bankRecords(c, p.banks, accountNames, 'QuickBooks Online')
  const gl = s.GeneralLedger
  requireThat(gl?.Header?.StartPeriod === from && gl.Header.EndPeriod === cutoverDate && gl.Header.ReportBasis === 'Accrual', 'General ledger dates or basis differ from the reviewed history')
  const headers = gl.Columns?.Column ?? [], index = (name: string) => headers.findIndex((v: Data) => v.MetaData?.some((m: Data) => m.Name === 'ColKey' && m.Value === name))
  const dayAt = index('tx_date'), typeAt = index('txn_type'), amountAt = index('subt_nat_amount'), numberAt = index('doc_num'), memoAt = index('memo'), nameAt = index('name')
  requireThat(dayAt >= 0 && typeAt >= 0 && amountAt >= 0, 'Intuit general ledger is missing transaction columns')
  let history = 0
  for (const r of qboReportRows(gl)) {
    const cells = r.ColData, day = cells[dayAt]?.value
    if (!day) continue
    const reference = cells[typeAt]?.id
    add('history', `${reference ?? 'line'}:${++history}`, () => ({ account: text(r.group, 'History account', 200), date: date(day, 'History date'), type: cells[typeAt]?.value ?? '', num: cells[numberAt]?.value ?? '', name: cells[nameAt]?.value ?? '', memo: cells[memoAt]?.value ?? '', split: '', amount: money(cells[amountAt]?.value, 'History amount'), row: history }))
  }
  c.out.push({ kind: 'cutover', sourceId: cutoverDate, artifact: 'apiSnapshot', row: 0, payload: { date: cutoverDate, rows: tbRows } })
  return { list: c.out, cutoverDate, tbRows, accountNames, extraChecks: [], notImported: [{ what: 'History as new ledger postings', count: history, why: 'History stays read-only; its financial effect is already in the opening trial balance.' }, { what: 'Attachments', count: s.Attachable.length, why: 'Original downloads and exact source placement must be completed separately in Document archives.' }] }
}
