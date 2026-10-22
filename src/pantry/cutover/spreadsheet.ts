import { dimensionTags } from '../dimensions'
// Source-neutral spreadsheet rows become the same staged records as the report
// kits. Every physical data row survives in the preview, including zero balances.
import { canonicalJson, sha256 } from '../../modules/import-kit/src/d1/index'
import { cents, date, requireThat, text, type Data } from '../core'
import { usDate } from '../statement-files'
import { bankRecords, collector, idsFor, type Account, type Package, type Parsed, type Source, type TbRow } from './source'
import { DATASETS, SHEET_LABELS, type Dataset, type SheetMappings } from './spreadsheet-schema'
import type { Sheet } from './spreadsheet-files'

export type SpreadsheetPackage = Package & { spreadsheet: { sheets: Partial<Record<Dataset, Sheet>>; mappings: SheetMappings; keys: Data[]; native: Record<string, Data[]> } }
const ids = idsFor('sheet')
const KIND: Record<Dataset, string> = { accounts: 'account', customers: 'customer', vendors: 'vendor', items: 'item', openInvoices: 'invoice', unpaidBills: 'bill', trialBalance: 'trial-balance' }
export const TARGET: Record<string, string> = { account: 'chart', customer: 'counterparty', vendor: 'counterparty', item: 'item', invoice: 'invoice', bill: 'bill' }
export const fold = (s: string) => s.trim().toLowerCase()

function parse(p: SpreadsheetPackage): Parsed {
  const c = collector(), { sheets, mappings, keys, native } = p.spreadsheet
  const cutoverDate = date(p.cutoverDate, 'Cutover date'), accountNames = new Map<string, Account>(), nativeIds: Record<string, string> = {}
  const snapshots: Record<string, string> = {}, nativeValues: Record<string, Data> = {}
  for (const [kind, rows] of Object.entries(native)) for (const r of rows) { if (r.revision) snapshots[`${kind}:${r.id}`] = r.revision; nativeValues[`${kind}:${r.id}`] = r }
  for (const cut of native.cutover) nativeValues[`cutover:${cut.id}`] = { cutover: cut, entry: native.entry.find(e => e.id === cut.opening_entry_id), lines: native.line.filter(l => l.entry_id === cut.opening_entry_id) }
  for (const r of native.chart) { const a = { name: r.name, code: r.code, type: r.type, subtype: r.subtype, description: r.description, detail: '' }; accountNames.set(fold(r.name), a); if (r.code) accountNames.set(fold(r.code), a); nativeIds[ids.account(r.name)] = r.id }
  const parties = { customer: new Map<string, string>(), vendor: new Map<string, string>() }
  for (const r of native.counterparty) { parties[r.kind as 'customer' | 'vendor'].set(fold(r.name), r.id); nativeIds[ids.contact(r.kind, r.name)] = r.id }
  const seen = new Map<Dataset, Set<string>>()
  const identify = (key: Dataset, kind: string, x: Data, name: string, defaultId: string) => {
    const names = seen.get(key) ?? new Set<string>(); seen.set(key, names)
    requireThat(!names.has(`name:${fold(name)}`), `Duplicate name "${name}" in this spreadsheet`)
    const ext = x.externalId?.trim() ?? ''
    requireThat(ext.length <= 200, 'External ID must be at most 200 characters')
    requireThat(!ext || !names.has(`id:${fold(ext)}`), `Duplicate external ID "${ext}" in this spreadsheet`)
    const byId = ext ? keys.find(k => k.dataset === key && k.external_id === sha256(fold(ext))) : undefined
    const byName = keys.find(k => k.dataset === key && k.name === sha256(fold(name)))
    requireThat(!byId || !byName || byId.id === byName.id, `External ID and name identify different records for "${name}"`)
    const table = native[TARGET[kind]], match = table.find(r => kind === 'account' || kind === 'item' ? fold(r.name) === fold(name) : kind === 'invoice' ? fold(r.number) === fold(name) : kind === 'bill' ? `${r.vendor_id}|${fold(r.reference)}` === `${parties.vendor.get(fold(x.party ?? ''))}|${fold(x.number ?? '')}` : r.kind === kind && fold(r.name) === fold(name))
    const targetId = byId?.id ?? byName?.id ?? match?.id ?? (ext ? `sheet-${kind}-${sha256(fold(ext)).slice(0, 20)}` : defaultId)
    requireThat(!byId || !match || byId.id === match.id, `Duplicate name "${name}" belongs to another record`)
    requireThat(!names.has(`target:${targetId}`), `Two rows identify the same record "${name}"`)
    names.add(`name:${fold(name)}`); names.add(`target:${targetId}`); if (ext) names.add(`id:${fold(ext)}`)
    nativeIds[defaultId] = targetId
    return { _target: targetId, _external: ext || match?.external_ref || '', _externalHash: ext ? sha256(fold(ext)) : byId?.external_id || byName?.external_id || '', _matchName: sha256(fold(name)), _dataset: key }
  }
  const rows = (key: Dataset, build: (x: Data, row: number) => Data) => {
    const sheet = sheets[key]; if (!sheet) return
    const cols = mappings[key] ?? {}, kind = KIND[key]
    for (const r of sheet.rows) {
      const x = Object.fromEntries(Object.entries(cols).filter(([, header]) => header).map(([field, header]) => [field, (r.cells[sheet.headers.indexOf(header)] ?? '').trim()]))
      try {
        requireThat(!r.error, r.error ?? '')
        requireThat(r.cells.length <= sheet.headers.length, 'Row has values beyond the mapped header columns')
        c.out.push({ kind, artifact: key, row: r.row, sourceId: `${key}:${r.row}`, payload: build(x, r.row) })
      } catch (e) { c.refuse(kind, key, r.row, (e as Error).message, { cells: sheet.headers.map((column, i) => ({ column, content: r.cells[i] ?? '' })) }) }
    }
  }
  rows('accounts', x => {
    const name = text(x.name, 'Account name', 200), type = fold(x.type ?? ''), subtype = fold(x.subtype || 'other')
    requireThat(['asset', 'liability', 'equity', 'income', 'expense'].includes(type), 'Account type must be asset, liability, equity, income or expense')
    requireThat(['other', 'bank', 'receivable', 'payable', 'tax', 'retained'].includes(subtype), 'Unknown account role')
    requireThat(!['bank', 'receivable'].includes(subtype) || type === 'asset', `${subtype} must be an asset`)
    requireThat(!['payable', 'tax'].includes(subtype) || type === 'liability', `${subtype} must be a liability`)
    requireThat(subtype !== 'retained' || type === 'equity', 'Retained earnings must be equity')
    const code = text(x.code, 'Account code', 20)
    const identity = identify('accounts', 'account', x, name, ids.account(name))
    requireThat(![...accountNames.values()].some(a => a.code === code && nativeIds[ids.account(a.name)] !== identity._target), `Account code ${code} belongs to another account`)
    for (const [alias, old] of accountNames) if (nativeIds[ids.account(old.name)] === identity._target) accountNames.delete(alias)
    const a = { name, code, type, subtype, detail: '', description: x.description ?? '' }
    accountNames.set(fold(name), a); accountNames.set(fold(code), a)
    return { ...a, ...identity }
  })
  for (const [key, kind] of [['customers', 'customer'], ['vendors', 'vendor']] as const) rows(key, x => {
    const name = text(x.name, `${kind} name`, 200)
    requireThat(!x.termsDays || /^\d{1,3}$/.test(x.termsDays), 'Terms days must be a whole number from 0 to 999')
    const identity = identify(key, kind, x, name, ids.contact(kind, name)), prior = native.counterparty.find(r => r.id === identity._target)
    const email = (x.email === undefined ? prior?.email ?? '' : x.email).toLowerCase()
    requireThat(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Email address is invalid')
    parties[kind].set(fold(name), identity._target)
    return { name, email, termsDays: x.termsDays === undefined ? prior?.terms_days ?? 30 : Number(x.termsDays || 30), ...identity }
  })
  const knownAccount = (v: string) => { const a = accountNames.get(fold(v ?? '')); requireThat(a, `Unknown account "${v ?? ''}"`); return a }
  const taxDecision = (x: Data, item = false) => {
    const allowed = item ? ['taxable', 'non-taxable'] : ['included', 'non-taxable']
    requireThat(allowed.includes(fold(x.taxDecision ?? '')), `Missing tax decision: choose ${allowed.join(' or ')}`)
    return fold(x.taxDecision)
  }
  rows('items', x => {
    const name = text(x.name, 'Item name', 200), account = knownAccount(x.account), category = taxDecision(x, true)
    requireThat(account.type === 'income', 'An item needs an income account')
    const kind = x.kind || 'service'; requireThat(['service', 'non-inventory'].includes(kind), 'Item kind must be service or non-inventory')
    const sku = x.sku || null; requireThat(!sku || sku.length <= 64, 'SKU must be at most 64 characters')
    const identity = identify('items', 'item', x, name, `sheet-item-${sha256(fold(name)).slice(0, 20)}`)
    requireThat(!sku || !native.item.some(r => r.id !== identity._target && fold(r.sku ?? '') === fold(sku)), `SKU ${sku} is already used by another item`)
    requireThat(!sku || !c.out.some(r => r.kind === 'item' && !r.payload.refused && fold(r.payload.sku ?? '') === fold(sku)), `Duplicate SKU ${sku}`)
    requireThat(!x.taxCode || category === 'taxable', 'A non-taxable item cannot have a tax code')
    requireThat(!x.taxCode || native.tax.some(r => r.id === x.taxCode && r.active), 'Unknown or inactive tax code')
    return { name, kind, sku, description: x.description || '', rate: cents(x.rate, 'Rate', { zero: true }), account: account.name, taxDecision: category, taxCode: x.taxCode || null, ...identity }
  })
  const tbRows: TbRow[] = []
  const tbAccounts = new Set<string>()
  rows('trialBalance', (x, row) => {
    const account = knownAccount(x.account), debit = cents(x.debit || '0', 'Debit', { zero: true }), credit = cents(x.credit || '0', 'Credit', { zero: true })
    requireThat(!(debit && credit), 'A trial balance row has a debit or a credit')
    const tags=dimensionTags(x),key=JSON.stringify([account.name,...Object.values(tags)])
    requireThat(!tbAccounts.has(key), `Duplicate name "${account.name}" in the opening trial balance`)
    tbAccounts.add(key); const t = { ...tags,account: account.name, debit, credit, row }; tbRows.push(t); return t
  })
  for (const [key, kind, partyKind, role] of [['openInvoices', 'invoice', 'customer', 'receivable'], ['unpaidBills', 'bill', 'vendor', 'payable']] as const) rows(key, x => {
    const party = text(x.party, `${partyKind} name`, 200)
    requireThat(parties[partyKind].has(fold(party)), `Unknown ${partyKind} "${party}"`)
    nativeIds[ids.contact(partyKind, party)] = parties[partyKind].get(fold(party))!
    const account = knownAccount(x.account); requireThat(account.subtype === role, `${account.name} is not a ${role} control account`)
    const num = text(x.number, 'Document number', 80), day = usDate(x.date, 'Date'), due = x.due ? usDate(x.due, 'Due date') : day
    requireThat(day <= cutoverDate, `Dated after the cutover date ${cutoverDate}`)
    const open = cents(x.open, 'Open balance'), original = cents(x.original || x.open, 'Original amount')
    requireThat(open <= original, 'Open balance exceeds the original amount')
    const tax = taxDecision(x), name = kind === 'invoice' ? num : `${party}|${num}`
    return { party, num, date: day, due, open, original, account: account.name, taxDecision: tax, ...identify(key, kind, x, name, kind === 'invoice' ? ids.invoice(num) : ids.bill(party, num)) }
  })
  bankRecords(c, p.banks, accountNames, 'spreadsheet')
  const opening = !!sheets.trialBalance
  if (opening) {
    const debit = tbRows.reduce((s, r) => s + r.debit, 0), credit = tbRows.reduce((s, r) => s + r.credit, 0)
    if (debit !== credit) c.refuse('opening', 'trialBalance', 0, `Unbalanced opening: debits ${(debit / 100).toFixed(2)}, credits ${(credit / 100).toFixed(2)}`)
    c.out.push({ kind: 'cutover', sourceId: cutoverDate, payload: { date: cutoverDate, rows: tbRows }, artifact: 'trialBalance', row: 0 })
  }
  const hasOpen = !!sheets.openInvoices || !!sheets.unpaidBills
  for (const rec of c.out) {
    // A new source revision can supersede a prior import while the target id stays
    // stable; expected native revisions fence preview → commit and undo.
    const target = TARGET[rec.kind], targetId = rec.payload._target ?? (rec.kind === 'bank' ? ids.bank(rec.payload.account) : ''), revision = targetId ? snapshots[`${target ?? rec.kind}:${targetId}`] ?? '' : ''
    rec.sourceId += ':' + sha256(canonicalJson({ payload: rec.payload, revision, keysRevision: rec.payload._target ? snapshots[`spreadsheet-key:${rec.payload._target}`] ?? '' : '', cutoverRevision: rec.kind === 'cutover' ? snapshots[`cutover:${ids.cutover(cutoverDate)}`] ?? '' : '' })).slice(0, 20)
  }
  return { list: c.out, cutoverDate, accountNames, tbRows, nativeIds, snapshots, nativeValues,
    extraChecks: hasOpen && !opening ? [{ key: 'opening-required', title: 'Open items have an opening trial balance', ok: false, detail: 'Upload the opening trial balance alongside the open invoices and bills' }] : [],
    notImported: [], listOnly: !opening && !hasOpen }
}

export const spreadsheets: Source = { key: 'spreadsheet', name: 'Spreadsheet', prefix: 'sheet', namespace: 'spreadsheet-cutover', files: DATASETS, labels: SHEET_LABELS, parse: p => parse(p as SpreadsheetPackage), missingDocuments: n => `${n} open invoices and bills have no source document in these spreadsheets. Upload their originals in Documents.` }
