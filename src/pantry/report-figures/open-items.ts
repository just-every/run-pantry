// Receivables and payables ageing: an item's open amount opens to its document
// less the allocations counted against it; bucket and item totals to their open
// items; unapplied money to the payments and credits not yet applied; the
// control balance to its posted lines; the subledger to items less unapplied.
import { requireThat, type Data } from '../core'
import { ageing } from '../reports'
import { appliedAsOf, unappliedRows } from '../open-items'
import { FIRST_DAY, reportSourceRows } from '../report-sources'
import { attachments, bankMatches, recordLabels } from '../records'
import { figureResult, less, parseLine } from './result'

type Kind = 'receivable' | 'payable'
export async function openItemSources(db: D1Database, kind: Kind, asOf: string) {
  const report = await ageing(db, kind, asOf), labels = await recordLabels(db), docs = await attachments(db), bank = await bankMatches(db)
  const docKind = kind === 'receivable' ? 'invoice' : 'bill'
  const account = report.control ? { id: report.control.id, code: report.control.code, name: report.control.name } : null
  const row = (key: string, date: string, amount: number, description: string, record: Data) => ({ key, date, account, amount, debit: Math.max(amount, 0), credit: Math.max(-amount, 0), description, lineMemo: '', entry: null, settlement: null,
    record: { ...record, label: labels.label(record.kind, record.id) }, documents: docs.forRecords([record as never]), bank: record.kind === 'payment' ? bank.forPayment(record.id) : [] })
  const itemRow = (i: Data) => row(`item:${i.id}`, i.doc_date, i.open, `${i.ref} · ${i.contact} · due ${i.due_date} · ${i.bucket}`, { kind: docKind, id: i.id })
  const applied = await appliedAsOf(db, kind, asOf)
  const itemDetail = (i: Data) => [row(`doc:${i.id}`, i.doc_date, i.total_cents, `${i.ref} · ${i.contact} · original amount`, { kind: docKind, id: i.id }),
    ...applied.filter(a => a.target_id === i.id).map(a => row(`applied:${a.id}`, a.allocation_date, -a.amount_cents, `Applied ${a.allocation_date}`,
      a.source_kind === 'payment' ? { kind: 'payment', id: a.source_id } : kind === 'receivable' ? { kind: 'invoice', id: a.source_id } : { kind: 'entry', id: labels.vendorCreditEntries.get(a.source_id) }))]
  const unapplied = async () => (await unappliedRows(db, kind, asOf)).map(u => row(`${u.part}:${u.id}`, u.date, u.amount, u.part === 'payment' ? `Payment${u.note ? ` ${u.note}` : ''}` : u.part === 'credit' ? 'Credit' : 'Applied to an open item', u.record))
  const control = async () => report.control ? reportSourceRows(db, { accountId: report.control.id, types: [], from: FIRST_DAY, to: asOf, sign: kind === 'receivable' ? 1 : -1 }, 'accrual') : []
  return { report, itemRow, itemDetail, unapplied, control }
}

export async function ageingFigure(db: D1Database, report: 'receivables' | 'payables', line: string, asOf: string) {
  const kind: Kind = report === 'receivables' ? 'receivable' : 'payable'
  const [part, id] = parseLine(line, [1, 2], 'Choose a figure on this ageing')
  const s = await openItemSources(db, kind, asOf), r = s.report
  const base = { report, line, basis: 'accrual' as const, basisLabel: 'Open items · accrual basis', from: null, to: asOf }
  if (part === 'item') {
    const item = (r.items as Data[]).find(i => i.id === id)
    requireThat(item, 'Choose an open item on this ageing', 404)
    return figureResult({ ...base, label: `${item.ref} · ${item.contact} · open`, figure: item.open, rows: s.itemDetail(item) })
  }
  if (part === 'bucket') {
    const k = r.buckets.indexOf(id)
    requireThat(k >= 0, 'Choose an ageing bucket', 404)
    return figureResult({ ...base, label: `${id} · open`, figure: r.totals[k], rows: (r.items as Data[]).filter(i => i.bucket === id).map(s.itemRow) })
  }
  requireThat(!id, 'Choose a figure on this ageing', 404)
  if (part === 'items') return figureResult({ ...base, label: 'Open items', figure: r.itemsTotal, rows: (r.items as Data[]).map(s.itemRow) })
  if (part === 'unapplied') return figureResult({ ...base, label: kind === 'receivable' ? 'Received or credited, not yet applied' : 'Paid or credited, not yet applied', figure: r.unapplied, rows: await s.unapplied() })
  if (part === 'subledger') return figureResult({ ...base, label: kind === 'receivable' ? 'Receivables' : 'Payables', figure: r.subledger, rows: [...(r.items as Data[]).map(s.itemRow), ...less(await s.unapplied(), 'unapplied')], scopeNote: 'Open items less money not yet applied.' })
  requireThat(part === 'control' && r.control, 'Choose a figure on this ageing', 404)
  return figureResult({ ...base, label: `${r.control.code} · ${r.control.name}`, figure: r.control.balance, rows: await s.control(), scopeNote: `All posted activity through ${asOf}.` })
}
