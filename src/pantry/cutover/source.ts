// What every move-in source hands the shared kit:
// its files, and those files parsed into one record per row in the same shapes,
// so the tie-outs, the import plan and the sign-off are the same for both.
import { sha256 } from '../../modules/import-kit/src/d1/index'
import { cents, requireThat, text, type Data } from '../core'
import type { Checks } from './plan'

export type Rec = { kind: string; sourceId: string; payload: Data; artifact: string; row: number }
export type Account = { name: string; code: string; type: string; subtype: string; detail: string; description: string }
export type TbRow = { account: string; debit: number; credit: number; row: number }
/** Something in the files that does not come in, with how many and why. */
export type Left = { what: string; count: number; why: string }

export type Parsed = {
  list: Rec[]; cutoverDate: string; tbRows: TbRow[]
  /** Accounts by lower-case name (and any other spelling the trial balance uses). */
  accountNames: Map<string, Account>
  /** Source-specific tie-outs, beside the shared ones. */
  extraChecks: Checks
  nativeIds?: Record<string, string>
  snapshots?: Record<string, string>
  nativeValues?: Record<string, Data>
  listOnly?: boolean
  notImported: Left[]
}

export type Package = { files: Record<string, { name: string; content: string; base64?: string }>; banks: Data[]; cutoverDate?: string }

export type Source = {
  key: 'quickbooks-online' | 'xero' | 'spreadsheet'
  name: string
  /** Prefix of every imported row's id, and the import kit's namespace and mapping version. */
  prefix: string
  namespace: string
  files: readonly string[]
  labels: Record<string, string>
  parse(p: Package): Parsed
  /** The sentence about source documents the export does not carry. */
  missingDocuments(openItems: number): string
}

const key = (s: string) => sha256(s.trim().toLowerCase()).slice(0, 20)
export const idsFor = (prefix: string) => ({
  account: (name: string) => `${prefix}-account-${key(name)}`,
  contact: (kind: string, name: string) => `${prefix}-${kind}-${key(name)}`,
  bank: (name: string) => `${prefix}-bank-${key(name)}`,
  invoice: (num: string) => `${prefix}-invoice-${key(num)}`,
  bill: (vendor: string, num: string) => `${prefix}-bill-${key(vendor + '|' + num)}`,
  cutover: (day: string) => `${prefix}-cutover-${day}`,
  history: (row: number) => `${prefix}-history-${row}`,
})

/** Collects records; a row that cannot map stays in the plan as a refusal with its reason. */
export function collector() {
  const out: Rec[] = []
  const refuse = (kind: string, artifact: string, row: number, reason: string, payload: Data = {}) => out.push({ kind, sourceId: `${artifact}:${row}`, payload: { ...payload, refused: reason }, artifact, row })
  const attempt = (kind: string, artifact: string, row: number, build: () => Data, sourceId: () => string) => {
    try { const payload = build(); out.push({ kind, sourceId: sourceId(), payload, artifact, row }) } catch (e) { refuse(kind, artifact, row, (e as Error).message) }
  }
  return { out, refuse, attempt }
}

/** The bank details a person types at review: one per Bank account on the trial balance. */
export function bankRecords(c: ReturnType<typeof collector>, banks: Data[], accountNames: Map<string, Account>, sourceName: string) {
  for (const [i, b] of banks.entries()) c.attempt('bank', 'banks', i + 1, () => {
    const name = text(b.account, `Bank account (${sourceName} name)`, 200)
    const account = accountNames.get(name.toLowerCase())
    requireThat(account && account.subtype === 'bank', `"${name}" is not a Bank account in the ${sourceName} chart of accounts`)
    const last4 = text(b.last4, 'Last four digits', 4)
    requireThat(/^\d{4}$/.test(last4), 'Enter the last four digits of the account number')
    return { account: account.name, institution: text(b.institution, 'Bank', 120), last4, statementBalance: cents(b.statementBalance, 'Reconciled statement balance at cutover', { signed: true, zero: true }) }
  }, () => b.account)
}
