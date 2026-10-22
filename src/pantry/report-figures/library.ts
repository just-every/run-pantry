import { dimensionReconciliation } from '../dimensions/reconciliation'
import type { DimensionScope } from '../dimensions/scope'
// Everyday-library figures: each money cell and total opens to the ledger
// lines, payments or open items its row or total was read from, under the
// report's own range, basis and account/payee filters.
import { requireThat, type Data } from '../core'
import { all } from '../db'
import type { Basis } from '../basis'
import { FIRST_DAY, reportSourceRows } from '../report-sources'
import { attachments, bankMatches, recordLabels } from '../records'
import { contractorPayments, libraryReport } from '../report-library'
import { openItemSources } from './open-items'
import { reconciliationState } from '../reconcile'
import { figureResult, less, parseLine } from './result'

const RECEIVABLE = ['receivables-summary', 'open-invoices', 'customer-balances']
const TYPES = ['asset', 'liability', 'equity', 'income', 'expense']

export async function libraryFigure(db: D1Database, kind: string, line: string, from: string, to: string, basis: Basis, account?: string, payee?: string, dimension?: DimensionScope) {
  const report = await libraryReport(db, kind, from, to, basis, account, payee, dimension)
  const [rowId, column] = parseLine(line, [2, 2], 'Choose a figure on this report'), index = Number(column)
  const total = rowId === 'total', row = report.rows.find(r => r.id === rowId)
  const figure = total ? report.totals[index]?.amount : report.moneyColumns.includes(index) ? row?.cells[index] : undefined
  requireThat(typeof figure === 'number' && kind !== 'audit-log', 'Choose a figure on this report', 404)
  const name = total ? report.totals[index].label : `${row!.cells.filter((_, i) => !report.moneyColumns.includes(i)).join(' · ')} · ${report.columns[index]}`
  const base = { report: kind, line, label: name, basis, basisLabel: report.basisLabel, from, to, figure, context: { ...(dimension ? { dimension: dimension.kind, dimensionValue: dimension.id } : {}), ...(account ? { account } : {}), ...(payee ? { payee } : {}) } }
  const ids = new Set(total ? report.rows.map(r => r.id) : [rowId])
  if (kind === 'reconciliations') return figureResult({ ...base, ...await proofRows(db, rowId, index, dimension) })
  if (kind === 'transactions' || kind === 'journal') {
    const credit = total ? index === 1 : index === 6
    const rows = (await reportSourceRows(db, { accountId: account, types: TYPES, from, to, sign: 1 }, basis)).filter(r => ids.has(r.key)).map(r => ({ ...r, amount: credit ? r.credit : r.debit }))
    return figureResult({ ...base, rows })
  }
  if (kind === 'deposits') return figureResult({ ...base, rows: (await reportSourceRows(db, { types: ['asset'], from, to, sign: 1 }, 'accrual')).filter(r => ids.has(r.key)) })
  if (kind === 'check-detail' || kind === 'contractor-summary') {
    const labels = await recordLabels(db), docs = await attachments(db), bank = await bankMatches(db)
    const payment = (p: Data) => ({ key: p.id, date: p.payment_date, account: null, amount: p.amount_cents, debit: p.amount_cents, credit: 0, description: `${p.method}${p.reference ? ` · ${p.reference}` : ''}`, lineMemo: '', entry: null, settlement: null,
      record: { kind: 'payment', id: p.id, label: labels.label('payment', p.id) }, documents: docs.forRecords([{ kind: 'payment', id: p.id }]), bank: bank.forPayment(p.id) })
    if (kind === 'check-detail') {
      const counted = new Set(report.rows.filter(r => ids.has(r.id) && (!total || r.cells[5] !== 'Reversed')).map(r => r.id))
      return figureResult({ ...base, rows: (await all(db, 'SELECT * FROM pt_payments WHERE id IN (SELECT value FROM json_each(?)) ORDER BY payment_date, reference, id', JSON.stringify([...counted]))).map(payment) })
    }
    const wanted = total ? 'counted' : (['', '', 'counted', 'excluded', 'unknown'] as string[])[index]
    return figureResult({ ...base, rows: (await contractorPayments(db, from, to, dimension)).filter(p => ids.has(p.group) && p.class === wanted).map(payment) })
  }
  const s = await openItemSources(db, RECEIVABLE.includes(kind) ? 'receivable' : 'payable', to, dimension)
  if (kind.endsWith('-balances')) {
    if (total) return figureResult({ ...base, rows: await s.control(), scopeNote: `All posted activity through ${to}.` })
    const receivable = kind === 'customer-balances', subtype = new Set((await all(db, 'SELECT id FROM pt_accounts WHERE subtype = ?', receivable ? 'receivable' : 'payable')).map(a => a.id))
    const rows = (await reportSourceRows(db, { types: [receivable ? 'asset' : 'liability'], from: FIRST_DAY, to, sign: receivable ? 1 : -1 }, 'accrual')).filter(r => subtype.has(r.account.id) && r.contactId === rowId && (!dimension||String(r[dimension.kind+'_name']??'')===dimension.value))
    return figureResult({ ...base, rows, scopeNote: `Control-account lines for this contact through ${to}.` })
  }
  const items = (s.report.items as Data[]).filter(i => i.doc_date >= from)
  if (kind.endsWith('-summary')) {
    const bucket = total || index === 6 ? null : s.report.buckets[index - 1]
    return figureResult({ ...base, rows: items.filter(i => (total || i.contact_id === rowId) && (!bucket || i.bucket === bucket)).map(s.itemRow) })
  }
  if (total) return figureResult({ ...base, rows: items.map(s.itemRow) })
  const item = items.find(i => i.id === rowId)!
  return figureResult({ ...base, rows: index === 5 ? [s.itemDetail(item)[0]] : s.itemDetail(item) })
}

/** A reconciliation proof figure: statement balances open to the statement, book and cleared figures to the bank
 *  account's posted lines through the end date, outstanding to the postings no statement line has cleared. */
async function proofRows(db: D1Database, statementId: string, index: number, dimension?: DimensionScope) {
  const state = await reconciliationState(db, statementId), proof = state.completed ? JSON.parse(state.completed.proof) : state
  const docs = state.statement.document_id ? (await all(db, 'SELECT id, name, media_type FROM pt_documents WHERE id = ?', state.statement.document_id)).map(d => ({ id: d.id, name: d.name, mediaType: d.media_type })) : []
  const account = (await all(db, 'SELECT id, code, name FROM pt_accounts WHERE id = ?', state.bank.account_id))[0]
  const statement = (part: string, amount: number) => ({ key: `statement:${part}`, date: part === 'opening' ? state.statement.start_date : state.statement.end_date, account, amount, debit: Math.max(amount, 0), credit: Math.max(-amount, 0),
    description: `Statement ${state.statement.start_date} to ${state.statement.end_date} · ${part} balance`, lineMemo: '', entry: null, settlement: null, documents: docs, bank: [],
    record: { kind: 'statement', id: statementId, label: `Statement ending ${state.statement.end_date} · ${state.bank.name}`, href: `/app/bank?statement=${encodeURIComponent(statementId)}` } })
  if(dimension) {
    const selected=await dimensionReconciliation(db,state,dimension)
    const scopeNote='External statement balances are Unassigned; book contributions retain their bank-posting dimensions as of completion. This is a contribution to the whole statement proof.'
    if(index===2||index===3)return {rows:dimension.value===''?[statement(index===2?'opening':'closing',index===2?selected.opening:selected.closing)]:[],scopeNote}
    if(index===4)return {rows:selected.bookRows,scopeNote}
    if(index===5)return {rows:selected.outstandingRows,scopeNote}
    if(index===6)return {rows:selected.clearedRows,scopeNote}
    return {rows:[...(dimension.value===''?[statement('closing',selected.closing)]:[]),...less(selected.clearedRows,'cleared')],scopeNote}
  }
  const book = await reportSourceRows(db, { accountId: state.bank.account_id, types: [], from: FIRST_DAY, to: state.statement.end_date, sign: 1 }, 'accrual')
  const outstanding = new Set((proof.outstanding as Data[]).map(o => o.id))
  const cleared = book.filter(r => !outstanding.has(r.key))
  const scopeNote = state.completed ? 'Saved proof of the completed reconciliation; ledger lines are read through the statement end date.' : 'Unfinished reconciliation: the current proof.'
  if (index === 2) return { rows: [statement('opening', proof.opening)], scopeNote }
  if (index === 3) return { rows: [statement('closing', proof.closing)], scopeNote }
  if (index === 4) return { rows: book, scopeNote }
  if (index === 5) return { rows: book.filter(r => outstanding.has(r.key)), scopeNote }
  if (index === 6) return { rows: cleared, scopeNote }
  return { rows: [statement('closing', proof.closing), ...less(cleared, 'cleared')], scopeNote: `Statement closing less cleared books. ${scopeNote}` }
}
