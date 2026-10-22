import { dimensionTags } from '../dimensions'
// A source's parsed records → the reviewed import plan: the tie-outs a person
// and accountant review, the import kit's source bundle with the exact uploaded
// bytes, and the native rows each accepted record becomes.
import { Buffer } from 'node:buffer'
import { canonicalJson, sha256, type SourceBundle, type ImportMapping } from '../../modules/import-kit/src/d1/index'
import { requireThat, text, usd, type Data } from '../core'
import { idsFor, type Package, type Parsed, type Rec, type Source } from './source'

export function readPackage(source: Source, b: Data): Package {
  requireThat(b.files && typeof b.files === 'object', `Upload the ${source.name} export files`)
  const files: Package['files'] = {}
  for (const f of source.files) {
    const file = b.files[f]
    requireThat(file && typeof file.content === 'string' && file.content.length > 0 && file.content.length <= 2_000_000, `Upload the ${source.labels[f]} export (CSV, up to 2 MB)`)
    files[f] = { name: text(file.name ?? `${f}.csv`, 'File name', 200), content: file.content }
  }
  return { files, banks: Array.isArray(b.banks) ? b.banks : [], cutoverDate: b.cutoverDate }
}

export type Checks = { key: string; title: string; ok: boolean; detail: string }[]

/** Tie-outs a person and accountant review before anything is committed. */
export function checks(r: Parsed): Checks {
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
  const groupedBanks=new Map<string,{account:string;debit:number;credit:number}>()
  for(const t of r.tbRows.filter(x=>r.accountNames.get(x.account.toLowerCase())?.subtype==='bank')){const previous=groupedBanks.get(t.account);if(previous){previous.debit+=t.debit;previous.credit+=t.credit}else groupedBanks.set(t.account,{...t})}
  const tbBanks=[...groupedBanks.values()]
  for (const t of tbBanks) {
    const b = ok('bank').find(x => x.payload.account === t.account)
    out.push({ key: `bank:${t.account}`, title: `${t.account} agrees to its reconciled statement`, ok: !!b && b.payload.statementBalance === t.debit - t.credit,
      detail: b ? `Statement ${usd(b.payload.statementBalance)}; trial balance ${usd(t.debit - t.credit)}` : 'Enter this account\'s bank, last four digits and reconciled statement balance at cutover' })
  }
  const roles = [...r.accountNames.values()]
  const single = (subtype: string) => new Set(roles.filter(a => a.subtype === subtype).map(a => a.name)).size
  out.push({ key: 'controls', title: 'One receivable and one payable account', ok: single('receivable') <= 1 && single('payable') <= 1 && (invoices === 0 || single('receivable') === 1) && (bills === 0 || single('payable') === 1), detail: `${single('receivable')} receivable, ${single('payable')} payable` })
  return [...out, ...r.extraChecks]
}

/** Records into the kit's source bundle, with the exact uploaded bytes as artifacts. */
export function bundle(source: Source, p: Package, list: Rec[]): SourceBundle {
  // The bank details typed at review are an input too, kept beside the export files.
  const inputs = [...Object.entries(p.files).map(([f, file]) => ({ key: f, name: file.name, bytes: file.base64 ? Buffer.from(file.base64, 'base64') : new TextEncoder().encode(file.content) })),
    { key: 'banks', name: 'bank-details-entered-at-review.json', bytes: new TextEncoder().encode(canonicalJson(p.banks as any)) }]
  const artifacts = inputs.map(a => ({ ...a, sha256: sha256(a.bytes), base64: btoa(Array.from(a.bytes as Uint8Array, x => String.fromCharCode(x)).join('')) }))
  const by = Object.fromEntries(artifacts.map(a => [a.key, a]))
  const order = ['account', 'customer', 'vendor', 'item', 'bank', 'invoice', 'bill', 'trial-balance', 'cutover', 'history']
  const records = [...list].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).map(r => ({
    namespace: source.namespace, kind: r.kind, sourceId: r.sourceId, payload: r.payload as any, payloadHash: sha256(canonicalJson(r.payload as any)),
    artifactHash: by[r.artifact].sha256, location: { artifact: by[r.artifact].name, row: r.row } as any,
  }))
  return { records, diagnostics: [], artifacts: artifacts.filter((a, i) => artifacts.findIndex(b => b.name === a.name && b.sha256 === a.sha256) === i).map(a => ({ name: a.name, sha256: a.sha256, size: a.bytes.length, original: { status: 'available' as const, base64: a.base64 } })) }
}

export const mappingVersion = (source: Source, day: string) => `${source.prefix}-cutover-v1:${day}`

/** Native values: exactly the columns the target adapter reads back. */
export function mapping(source: Source, r: Parsed, preparedBy: string): ImportMapping {
  const day = r.cutoverDate, ids = idsFor(source.prefix), from = source.name
  const code = new Map<string, string>(), used = new Set<string>()
  const prefix: Record<string, number> = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 6000 }
  for (const a of [...r.accountNames.values()]) {
    if (code.has(a.name)) continue
    let c = a.code
    if (!c || used.has(c)) { let n = prefix[a.type]; while (used.has(String(n))) n += 10; c = String(n); prefix[a.type] = n + 10 }
    used.add(c); code.set(a.name, c)
  }
  return { version: mappingVersion(source, day), map(rec) {
    const x = rec.payload as Data
    if (x.refused) return { effects: [], rejection: x.refused }
    if (rec.kind === 'account') return { effects: [{ targetKind: 'chart', targetId: ids.account(x.name), value: { code: code.get(x.name)!, name: x.name, type: x.type, subtype: x.subtype, description: x.description || x.detail, active: 1 } }] }
    if (rec.kind === 'customer' || rec.kind === 'vendor') return { effects: [{ targetKind: 'counterparty', targetId: ids.contact(rec.kind, x.name), value: { kind: rec.kind, name: x.name, email: x.email, terms_days: 30, external_ref: from, active: 1 } }] }
    if (rec.kind === 'bank') return { effects: [{ targetKind: 'bank', targetId: ids.bank(x.account), value: { name: x.account, account_id: ids.account(x.account), institution: x.institution, number_last4: x.last4, routing: '', opening_date: day, opening_cents: x.statementBalance } }] }
    if (rec.kind === 'invoice') return { effects: [{ targetKind: 'invoice', targetId: ids.invoice(x.num), value: { kind: 'invoice', number: x.num, customer_id: ids.contact('customer', x.party), issue_date: x.date, due_date: x.due, status: 'issued', memo: `Opening item from ${from}; original amount ${usd(x.original)}`, credit_for: null, subtotal_cents: x.open, tax_cents: 0, total_cents: x.open, opening: 1, journal_id: null, prepared_by: preparedBy, approved_by: null, approved_revision: null, issued_by: null, created_at: day } }] }
    if (rec.kind === 'bill') return { effects: [{ targetKind: 'bill', targetId: ids.bill(x.party, x.num), value: { vendor_id: ids.contact('vendor', x.party), reference: x.num, bill_date: x.date, due_date: x.due, status: 'posted', memo: `Opening item from ${from}; original amount ${usd(x.original)}`, total_cents: x.open, opening: 1, evidence_waived: null, journal_id: null, prepared_by: preparedBy, created_at: day } }] }
    if (rec.kind === 'cutover') {
      const entryId = `${ids.cutover(day)}-entry`
      return { effects: [{ targetKind: 'cutover', targetId: ids.cutover(day), value: {
        cutover: { source: source.key, cutover_date: day, opening_entry_id: entryId, summary: `Opening balances from the ${from} trial balance as of ${day}`, status: 'staged', accepted_by: null, accepted_at: null },
        entry: { id: entryId, number: null, entry_date: day, memo: `Opening balances — ${from} trial balance as of ${day}`, source_kind: 'opening', source_id: ids.cutover(day), status: 'draft', prepared_by: preparedBy, prepared_kind: 'import', proposal_id: null, document_id: null, posted_by: null, posted_at: null, reverses_id: null, reversed_by_id: null, created_at: day },
        lines: x.rows.map((t: Data, i: number) => ({ class_name:dimensionTags(t).className,location_name:dimensionTags(t).locationName,project_name:dimensionTags(t).projectName,line_no: i + 1, account_id: ids.account(t.account), debit_cents: t.debit, credit_cents: t.credit, memo: 'Opening balance', contact_id: null })),
      } }] }
    }
    if (rec.kind === 'history') return { effects: [{ targetKind: 'history', targetId: ids.history(x.row), value: { cutover_id: ids.cutover(day), account: x.account, txn_date: x.date, txn_type: x.type, num: x.num, name: x.name, memo: x.memo, split: x.split, amount_cents: x.amount, source_row: x.row } }] }
    return { effects: [], rejection: `Unknown record ${rec.kind}` }
  } }
}
