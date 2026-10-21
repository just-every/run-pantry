// 1099 figures open to the year's payments to the vendor that make them, on the
// payment basis, with each payment's documents and bank lines.
import { requireThat } from '../core'
import { attachments, bankMatches, recordLabels } from '../records'
import { vendorYear } from '../contractors'
import { figureResult, parseLine } from './result'

const METRICS: Record<string, [string, (p: { reversed: boolean; counts: boolean; excluded: boolean; method: string }) => boolean]> = {
  box1: ['box 1 (check, ACH, wire, cash)', p => p.counts], excluded: ['card and networks (left out)', p => p.excluded],
  unrecorded: ['method not recorded', p => !p.reversed && p.method === 'unrecorded'], reversed: ['reversed payments', p => p.reversed],
}

export async function contractorFigure(db: D1Database, q: { line: string; year?: string; to: string }) {
  const year = Number(q.year ?? q.to.slice(0, 4))
  requireThat(Number.isInteger(year) && year >= 2000 && year <= 2100, 'Choose a tax year')
  const [vendorId, metric] = parseLine(q.line, [2, 2], 'Choose a 1099 figure')
  const vendor = (await vendorYear(db, year)).find(v => v.id === vendorId)
  requireThat(vendor && METRICS[metric], 'Choose a 1099 figure', 404)
  const labels = await recordLabels(db), docs = await attachments(db), bank = await bankMatches(db)
  const [name, counts] = METRICS[metric]
  const rows = vendor.payments.filter(counts).map(p => ({ key: p.id, date: p.date, account: null, amount: p.amount, debit: p.amount, credit: 0, description: `${p.method}${p.reference ? ` · ${p.reference}` : ''}`, lineMemo: '', entry: null, settlement: null,
    record: { kind: 'payment', id: p.id, label: labels.label('payment', p.id) }, documents: docs.forRecords([{ kind: 'payment', id: p.id }]), bank: bank.forPayment(p.id) }))
  return figureResult({ report: 'contractors', line: q.line, label: `${vendor.name} · ${name} · ${year}`, basis: 'payment', basisLabel: 'Payment basis', from: `${year}-01-01`, to: `${year}-12-31`,
    figure: metric === 'box1' ? vendor.box1 : metric === 'excluded' ? vendor.excluded : metric === 'unrecorded' ? vendor.unrecorded : vendor.reversed, rows, context: { year: String(year) } })
}
