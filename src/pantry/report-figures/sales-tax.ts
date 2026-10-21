// Sales tax figures: a code, state or all-states figure opens to the invoice and
// credit lines (accrual) or settled shares (cash) the report added up, early-
// payment columns to their discount credits (each linked to its invoice), and
// the ledger tie to the liability account's posted lines.
import { requireThat, type Data } from '../core'
import { all } from '../db'
import { cashLines, type Basis } from '../basis'
import { prevDay, settlementMemo } from '../reports'
import { FIRST_DAY, reportSourceRows } from '../report-sources'
import { attachments, bankMatches, recordLabels } from '../records'
import { FROM_SALES, figureParts, salesTax, salesTaxContributions, writeOffCredits, writtenOff } from '../sales-tax'
import { figureResult, parseLine } from './result'

const METRICS: Record<string, string> = { taxable: 'taxable sales', charged: 'tax charged', collected: 'tax collected', owed: 'tax owed', kept: 'early-payment discounts, tax kept', reduced: 'early-payment discounts, tax reduced', taxReduced: 'tax reduced', exempt: 'early-payment discounts on exempt sales' }
const PARTS: Record<string, string> = { opening: 'opening', fromSales: 'from invoices and credits', other: 'paid to the state and other', closing: 'closing', owed: 'tax owed above' }

type Figure = ReturnType<typeof figureResult>
export async function salesTaxFigure(db: D1Database, line: string, from: string, to: string, basis: Basis): Promise<Figure> {
  const selected = parseLine(line, [2, 3], 'Choose a figure on this sales tax report')
  const r = await salesTax(db, from, to, basis), codes = r.states.flatMap(s => s.codes)
  const base = { report: 'sales-tax', line, basis, from, to }
  if (selected[0] === 'account') return ledgerFigure(db, r, selected[1], selected[2], base)
  const [scope, id, metric] = selected.length === 3 ? selected : [selected[0], '', selected[1]]
  requireThat(METRICS[metric], 'Choose a figure on this sales tax report', 404)
  let keys: string[], figure: number, label: string
  if (scope === 'code') { const c = codes.find(x => x.id === id); requireThat(c, 'Choose a tax code on this report', 404); keys = [c.id]; figure = metric in c ? (c as Data)[metric] : (c.early as Data)[metric]; label = `${c.state} · ${c.name}` }
  else if (scope === 'state') { const s = r.states.find(x => x.state === id); requireThat(s, 'Choose a state on this report', 404); keys = s.codes.map(c => c.id); figure = metric in s ? (s as Data)[metric] : (s.early as Data)[metric]; label = id || 'State not set' }
  else if (scope === 'total') { requireThat(!id && ['taxable', 'charged', 'collected', 'owed'].includes(metric), 'Choose a figure on this sales tax report', 404); keys = codes.map(c => c.id); figure = (r.totals as Data)[metric]; label = 'All states' }
  else { requireThat(scope === 'exempt' && (metric === 'taxable' || metric === 'exempt'), 'Choose a figure on this sales tax report', 404); keys = ['exempt']; figure = metric === 'taxable' ? r.exempt : r.earlyExempt; label = 'Exempt sales' }
  requireThat(typeof figure === 'number', 'Choose a figure on this sales tax report', 404)
  const [set, part] = figureParts(metric, basis), wanted = new Set(keys)
  const labels = await recordLabels(db), docs = await attachments(db), bank = await bankMatches(db)
  const rows = (await salesTaxContributions(db, from, to)).filter(c => c.set === set && c.metric === part && wanted.has(c.key)).map(c => {
    const s = c.source, settled = s.kind === 'settled'
    const record = { kind: 'invoice', id: settled ? s.line.docId : s.id, label: labels.label('invoice', settled ? s.line.docId : s.id) }
    const paid = settled && s.line.settlement.paymentId ? { kind: 'payment', id: s.line.settlement.paymentId } : null
    const forInvoice = settled ? null : s.credit_for
    return { key: `${s.kind}:${settled ? s.index : s.line_id}:${part}`, date: settled ? s.line.date : s.kind === 'reversal' ? s.entry_date : s.issue_date, account: null, amount: c.amount, debit: Math.max(c.amount, 0), credit: Math.max(-c.amount, 0),
      description: settled ? settlementMemo(s.line) : `${s.kind === 'reversal' ? 'Reversal of ' : ''}${labels.label('invoice', s.id)} · ${s.description}`,
      lineMemo: settled ? s.line.description : '', entry: null, settlement: paid ? { kind: s.line.settlement.kind, by: { ...paid, label: labels.label('payment', paid.id) }, share: '' } : null,
      record, ...(forInvoice ? { invoice: { kind: 'invoice', id: forInvoice, label: labels.label('invoice', forInvoice) } } : {}),
      documents: docs.forRecords([record as never, ...(paid ? [paid as never] : [])]), bank: paid ? bank.forPayment(paid.id) : [] }
  })
  return figureResult({ ...base, label: `${label} · ${METRICS[metric]}`, figure, rows, scopeNote: set === 'paid' || set === 'cashEarly' ? 'Shares of invoice and credit lines settled in the range.' : 'Invoice and credit lines issued in the range, and early-payment discount reversals.' })
}

async function ledgerFigure(db: D1Database, r: Awaited<ReturnType<typeof salesTax>>, accountId: string, part: string, base: { report: string; line: string; basis: Basis; from: string; to: string }): Promise<Figure> {
  const a = r.ledger.accounts.find(x => x.id === accountId)
  requireThat(a && PARTS[part], 'Choose a liability account figure', 404)
  const label = `${a.code} · ${a.name} · ${PARTS[part]}`
  if (part === 'owed') {
    const codes = r.states.flatMap(s => s.codes).filter(c => c.accountId === accountId)
    const rows: Data[] = (await Promise.all(codes.map(async (c): Promise<Data[]> => (await salesTaxFigure(db, JSON.stringify(['code', c.id, 'owed']), base.from, base.to, base.basis)).rows.map((row: Data) => ({ ...row, key: `${c.id}:${row.key}` }))))).flat()
    return figureResult({ ...base, label, figure: a.owed, rows })
  }
  const sources = (from: string, to: string) => reportSourceRows(db, { accountId, types: [], from, to, sign: -1 }, base.basis)
  if (part === 'opening') return figureResult({ ...base, label, from: null, to: prevDay(base.from), figure: a.opening, rows: await sources(FIRST_DAY, prevDay(base.from)) })
  if (part === 'closing') return figureResult({ ...base, label, from: null, figure: a.closing, rows: await sources(FIRST_DAY, base.to) })
  const period = await sources(base.from, base.to)
  let sales: Set<string>
  if (base.basis === 'cash') {
    const writeOffs = await writeOffCredits(db)
    sales = new Set((await cashLines(db, base.from, base.to)).flatMap((c, i) => c.accountId === accountId && c.role === 'tax' && !writtenOff(c, writeOffs) ? [`cash-${i}`] : []))
  } else {
    const entries = new Set((await all(db, `SELECT e.id FROM pt_journal_entries e WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND ${FROM_SALES}`, base.from, base.to)).map(e => e.id))
    sales = new Set(period.filter(row => entries.has(row.entry.id)).map(row => row.key))
  }
  return figureResult({ ...base, label, figure: part === 'fromSales' ? a.fromSales : a.other, rows: period.filter(row => sales.has(row.key) === (part === 'fromSales')) })
}
