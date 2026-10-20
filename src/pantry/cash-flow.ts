// Indirect cash flow: accrual earnings, working-capital changes and noncash
// adjustments, then investing and financing. Integer cents throughout.
import { authority, who } from './access'
import { all, audit, q, run } from './db'
import { requireThat, text, type Data } from './core'
import type { Command } from './context'
import { balances, prevDay } from './reports'
import { FIRST_DAY, reportSourceRows } from './report-sources'

export const FLOW_CLASSES = ['cash', 'operating', 'investing', 'financing'] as const
export type FlowClass = typeof FLOW_CLASSES[number]
export const defaultFlowClass = (a: Data): FlowClass => {
  if (a.type === 'asset' && a.subtype === 'bank') return 'cash'
  if (a.type === 'equity' || (a.type === 'liability' && a.subtype === 'other')) return 'financing'
  if (a.type === 'asset' && a.subtype === 'other') return 'investing'
  return 'operating'
}

export async function flowAccounts(db: D1Database): Promise<(Data & { flowClass: FlowClass })[]> {
  return (await all(db, 'SELECT a.*, c.class FROM pt_accounts a LEFT JOIN pt_cash_flow_classes c ON c.account_id = a.id ORDER BY a.code'))
    .map(a => ({ ...a, flowClass: (a.class || defaultFlowClass(a)) as FlowClass }))
}

const classify: Command = { need: 'record', async run(c, b) {
  const id = text(b.accountId, 'Account'), cls = text(b.class, 'Cash-flow class')
  requireThat((FLOW_CLASSES as readonly string[]).includes(cls), 'Choose cash, operating, investing or financing')
  const a = (await flowAccounts(c.db)).find(a => a.id === id)
  requireThat(a, 'Account not found', 404)
  requireThat(cls !== 'cash' || a.type === 'asset', 'Only an asset can be cash or a cash equivalent')
  await run(c.db, [authority(c.actor, 'record'), q('INSERT INTO pt_cash_flow_classes (account_id, class) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET class = excluded.class', id, cls),
    audit(who(c.actor), 'cash-flow.classify', 'account', id, { class: cls })])
  return { accountId: id, class: cls }
} }
export const cashFlowCommands = { 'cash-flow.classify': classify }

type Contribution = { key: string; lineId: string; accountId: string; entryId: string; number: number; date: string; description: string; amount: number }
type FlowLine = { id: string; code: string; name: string; amount: number; rows: Contribution[] }
const sum = (rows: { amount: number }[]) => rows.reduce((n, r) => n + r.amount, 0)

export async function cashFlow(db: D1Database, from: string, to: string) {
  requireThat(from <= to, 'From must be on or before To')
  const accounts = await flowAccounts(db), byId = new Map(accounts.map(a => [a.id, a]))
  const posted = await all(db, `SELECT l.id, l.account_id, l.debit_cents, l.credit_cents, e.id AS entry_id, e.number, e.entry_date, e.memo
    FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date, e.number, l.line_no`, from, to)
  const cashIds = new Set(accounts.filter(a => a.flowClass === 'cash').map(a => a.id))
  const cashByEntry = new Map<string, number>()
  for (const l of posted) if (cashIds.has(l.account_id)) cashByEntry.set(l.entry_id, (cashByEntry.get(l.entry_id) ?? 0) + l.debit_cents - l.credit_cents)
  const lines = new Map<string, FlowLine>()
  const add = (id: string, name: string, l: Data, amount: number, code = '') => {
    if (!lines.has(id)) lines.set(id, { id, code, name, amount: 0, rows: [] })
    const line = lines.get(id)!
    line.rows.push({ key: `${id}:${l.id}`, lineId: l.id, accountId: l.account_id, entryId: l.entry_id, number: l.number, date: l.entry_date, description: l.memo, amount })
    line.amount += amount
  }
  lines.set('net-income', { id: 'net-income', code: '', name: 'Net income (accrual)', amount: 0, rows: [] })
  for (const l of posted) {
    const a = byId.get(l.account_id)!, amount = l.credit_cents - l.debit_cents
    if (a.type === 'income' || a.type === 'expense') {
      add('net-income', 'Net income (accrual)', l, amount)
      if (a.flowClass !== 'operating' && (cashByEntry.get(l.entry_id) ?? 0)) {
        add(a.id, `Cash activity · ${a.name}`, l, amount, a.code)
        add(`reclass:${a.id}`, `Remove ${a.name} from operating activities`, l, -amount, a.code)
      }
    } else if (a.flowClass !== 'cash') {
      // Transactions with no net cash (depreciation, equipment financed directly,
      // transfers between cash accounts) are excluded from investing/financing.
      // Their offset to earnings/working capital is an explicit noncash adjustment.
      const noncash = a.flowClass !== 'operating' && !(cashByEntry.get(l.entry_id) ?? 0)
      add(noncash ? `noncash:${a.id}` : a.id, noncash ? `Noncash adjustment · ${a.name}` : `Change in ${a.name}`, l, amount, a.code)
    }
  }
  const operating = [...lines.values()].filter(l => l.id === 'net-income' || l.id.startsWith('noncash:') || l.id.startsWith('reclass:') || byId.get(l.id)?.flowClass === 'operating')
  const investing = [...lines.values()].filter(l => byId.get(l.id)?.flowClass === 'investing')
  const financing = [...lines.values()].filter(l => byId.get(l.id)?.flowClass === 'financing')
  const opening = (await balances(db, prevDay(from))).filter(a => cashIds.has(a.id)).reduce((n, a) => n + a.net, 0)
  const closing = (await balances(db, to)).filter(a => cashIds.has(a.id)).reduce((n, a) => n + a.net, 0)
  const totalOperating = sum(operating), totalInvesting = sum(investing), totalFinancing = sum(financing), netChange = totalOperating + totalInvesting + totalFinancing
  return { basis: 'accrual', method: 'indirect', from, to, openingDate: prevDay(from), operating, investing, financing, totalOperating, totalInvesting, totalFinancing,
    opening, closing, netChange, balanceSheetChange: closing - opening, ties: netChange === closing - opening,
    cashAccounts: accounts.filter(a => cashIds.has(a.id)).map(a => ({ id: a.id, code: a.code, name: a.name })), accounts }
}

export async function cashFlowDetail(db: D1Database, from: string, to: string, id: string) {
  const r = await cashFlow(db, from, to), allLines = [...r.operating, ...r.investing, ...r.financing]
  const totals: Record<string, [string, FlowLine[]]> = { operating: ['Net cash from operating activities', r.operating], investing: ['Net cash from investing activities', r.investing], financing: ['Net cash from financing activities', r.financing], 'net-change': ['Net change in cash', allLines] }
  const total = totals[id], line = allLines.find(l => l.id === id)
  const detail = async (label: string, figure: number, rows: Contribution[], sourceFrom: string, sourceTo: string) => {
    const sources = new Map((await reportSourceRows(db, { types: ['asset', 'liability', 'equity', 'income', 'expense'], from: sourceFrom, to: sourceTo, sign: 1 }, 'accrual')).map(row => [row.key, row]))
    const enriched = rows.map(row => {
      const source = sources.get(row.lineId)
      requireThat(source, 'Cash-flow source line is unavailable', 409)
      return { ...source, ...row }
    })
    const sum = enriched.reduce((n, row) => n + row.amount, 0)
    return { label, figure, rows: enriched, accounts: r.accounts, basis: 'accrual' as const, basisLabel: 'Indirect method - accrual starting income', from: sourceFrom === FIRST_DAY ? null : sourceFrom, to: sourceTo, total: sum, ties: sum === figure }
  }
  if (id === 'opening' || id === 'closing') {
    const asOf = id === 'opening' ? r.openingDate : to
    const cashIds = new Set(r.cashAccounts.map(a => a.id))
    const rows = (await all(db, `SELECT l.*, e.id AS entry_id, e.number, e.entry_date, e.memo AS entry_memo FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id WHERE e.status = 'posted' AND e.entry_date <= ? ORDER BY e.entry_date, e.number, l.line_no`, asOf)).filter(l => cashIds.has(l.account_id))
      .map(l => ({ key: l.id, lineId: l.id, accountId: l.account_id, entryId: l.entry_id, number: l.number, date: l.entry_date, description: l.entry_memo, amount: l.debit_cents - l.credit_cents }))
    return detail(id === 'opening' ? 'Opening cash' : 'Closing cash', r[id], rows, FIRST_DAY, asOf)
  }
  requireThat(total || line, 'Choose a cash-flow figure', 404)
  const rows = total ? total[1].flatMap(l => l.rows) : line!.rows
  return detail(total?.[0] ?? line!.name, sum(rows), rows, from, to)
}

const cell = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`
export function cashFlowCsv(r: Awaited<ReturnType<typeof cashFlow>>) {
  const money = (v: number) => (v / 100).toFixed(2)
  const rows: unknown[][] = [['Statement of cash flows', 'Indirect method · starts from accrual net income', r.from, r.to], ['Section', 'Code', 'Line', 'Amount (USD)']]
  for (const [name, lines, total] of [['Operating', r.operating, r.totalOperating], ['Investing', r.investing, r.totalInvesting], ['Financing', r.financing, r.totalFinancing]] as const) {
    for (const l of lines) rows.push([name, l.code, l.name, money(l.amount)])
    rows.push([name, '', `Net cash from ${name.toLowerCase()} activities`, money(total)])
  }
  rows.push(['', '', 'Net change in cash', money(r.netChange)], ['', '', 'Opening cash', money(r.opening)], ['', '', 'Closing cash', money(r.closing)])
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
