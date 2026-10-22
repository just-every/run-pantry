// Explain trial-balance net balances and general-ledger cells from the native
// read models, preserving cash settlements and exact running-row order.
import { dimensionScope, inDimension } from './dimensions/scope'
import { requireThat, type Data } from './core'
import type { Basis } from './basis'
import { generalLedger, prevDay, trialBalance } from './reports'
import { FIRST_DAY, reportSourceRows } from './report-sources'

type Query = { report: string; line: string; from: string; to: string; basis: Basis; account?: string;dimension?:string;dimensionValue?:string }
export async function ledgerFigureDetail(db: D1Database, q: Query) {
  const dimension=await dimensionScope(db,q.dimension,q.dimensionValue)
  let selected: unknown
  try { selected = JSON.parse(q.line) } catch { requireThat(false, 'Choose a ledger figure', 404) }
  requireThat(Array.isArray(selected) && selected.length >= 2 && selected.length <= 3 && selected.every(v => typeof v === 'string'), 'Choose a ledger figure', 404)
  const [accountId, metric, rowId] = selected as string[]
  let rows: Data[], label: string, figure: number, from: string, to = q.to
  const sources = async (id: string | undefined, from: string, to: string) => (await reportSourceRows(db, { accountId: id, types: ['asset', 'liability', 'equity', 'income', 'expense'], from, to, sign: 1 }, q.basis)).filter(r=>inDimension(r,dimension))
  if (q.report === 'trial-balance') {
    requireThat(['debit', 'credit'].includes(metric) && !rowId, 'Choose a trial-balance debit or credit balance', 404)
    const report = await trialBalance(db, q.to, q.basis,dimension)
    const account = report.rows.find(a => a.id === accountId)
    requireThat(accountId === 'total' || account, 'Choose an account on this trial balance', 404)
    const sign = metric === 'debit' ? 1 : -1
    const accounts = new Set((account ? [account] : report.rows).filter(a => sign * a.net > 0).map(a => a.id))
    from = FIRST_DAY
    rows = (await sources(account?.id, from, to)).filter(r => accounts.has(r.account.id)).map(r => ({ ...r, amount: sign * r.amount }))
    figure = account ? metric === 'debit' ? account.debitBalance : account.creditBalance : metric === 'debit' ? report.debit : report.credit
    label = `${account ? `${account.code} · ${account.name}` : 'Total'} · ${metric} balance`
  } else {
    requireThat(!q.account || q.account === accountId, 'This account is outside the selected ledger filter', 404)
    const report = await generalLedger(db, q.from, q.to, q.account || undefined, q.basis,dimension)
    const account = report.accounts.find(a => a.id === accountId)
    requireThat(account, 'Choose an account on this general ledger', 404)
    const index = account.rows.findIndex((r: Data) => r.id === rowId)
    requireThat(['opening', 'closing'].includes(metric) ? !rowId : ['debit', 'credit', 'running'].includes(metric) && index >= 0, 'Choose a general-ledger figure', 404)
    const row = account.rows[index]
    label = `${account.code} · ${account.name} · ${metric}${row ? ` · ${row.entry_date} · ${row.entry_memo}` : ''}`
    if (metric === 'opening') {
      from = FIRST_DAY; to = prevDay(q.from); figure = account.opening
      rows = await sources(account.id, from, to)
    } else if (metric === 'closing' || metric === 'running') {
      from = FIRST_DAY
      const keys = new Set((metric === 'closing' ? account.rows : account.rows.slice(0, index + 1)).map((r: Data) => r.id))
      rows = [...(await sources(account.id, FIRST_DAY, prevDay(q.from))).map(r => ({ ...r, key: `opening:${r.key}` })), ...(await sources(account.id, q.from, q.to)).filter(r => keys.has(r.key))]
      figure = metric === 'closing' ? account.closing : row.running
      if (metric === 'running') to = row.entry_date
    } else {
      from = q.from
      rows = (await sources(account.id, q.from, q.to)).filter(r => r.key === rowId).map(r => ({ ...r, amount: metric === 'debit' ? r.debit : r.credit }))
      figure = metric === 'debit' ? row.debit_cents : row.credit_cents
    }
  }
  const total = rows.reduce((n, r) => n + r.amount, 0)
  return { ...(dimension?{context:{dimension:dimension.kind,dimensionValue:dimension.id},dimensionLabel:dimension.label}:{}),basis: q.basis, report: q.report, line: q.line, label:dimension?`${label} · ${dimension.label}`:label, ...(q.report === 'general-ledger' && metric === 'running' ? { scopeNote: 'Opening activity plus ledger rows through the selected row; later rows on the same date are excluded.' } : {}), from: from === FIRST_DAY ? null : from, to, figure, rows, total, ties: total === figure }
}
