import { dimensionTags } from './dimensions'
// INVOICE-010 discounts, delivery charges and deposits. A discount is a
// percentage or an amount on the subtotal of the item lines or on chosen lines.
// Before tax (the default) it is spread over its lines by largest remainder and
// each line's tax is on its amount less its share; after tax it leaves every
// line's tax on the undiscounted price. Either way it posts to the discounts
// account the accountant chose. A delivery charge is a line with its own tax
// code that subtotal discounts never reach, though a discount may name it. A
// deposit received at issue becomes a payment applied to the invoice when it is
// issued.
import { authority, who } from './access'
import { cents, date, longDay, now, optionalText, requireThat, scale, text, uid, usd, type Data } from './core'
import { all, audit, guard, one, q, run, type Sql } from './db'
import { METHODS } from './contractors'
import type { Command } from './context'

export type Discount = { type: 'percent' | 'amount'; value: number; lines: number[] | null; afterTax: boolean; amount: number; label: string }
type Priced = { amount: number; kind: 'item' | 'delivery'; discount: number }

/** "2.5" → 2500 milli-percent; more than 0 and at most `max` percent, up to three decimals. */
export function milliPercent(value: unknown, label: string, max = 100, inclusive = true) {
  const raw = String(value ?? '').trim()
  requireThat(/^\d{1,3}(\.\d{1,3})?$/.test(raw), `${label} is a percentage with up to three decimals, like 2.5`)
  const [w, f = ''] = raw.split('.'), milli = Number(w) * 1000 + Number(f.padEnd(3, '0'))
  requireThat(milli > 0 && (inclusive ? milli <= max * 1000 : milli < max * 1000), `${label} is more than 0% and ${inclusive ? 'at most' : 'less than'} ${max}%`)
  return milli
}

export const percentLabel = (milli: number) => `${(milli / 1000).toFixed(3).replace(/\.?0+$/, '')}%`

/** Shares of `total` in proportion to `weights` by largest remainder, ties to the lower line; they sum to `total`. */
export function spreadByWeight(weights: number[], total: number) {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (!sum) return weights.map(() => 0)
  const exact = weights.map(w => BigInt(w) * BigInt(total)), base = exact.map(x => Number(x / BigInt(sum)))
  let left = total - base.reduce((s, x) => s + x, 0)
  const order = exact.map((x, i) => ({ i, rem: x % BigInt(sum) })).sort((a, b) => a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1)
  for (const { i } of order) { if (left <= 0) break; base[i] += 1; left -= 1 }
  return base
}

/** Parse the discounts and apply the before-tax ones to `lines` (in order, each on what the earlier ones left). */
export function applyDiscounts(raw: unknown, lines: Priced[], credit: boolean): { discounts: Discount[]; afterTax: number } {
  const given = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : null
  requireThat(given, 'Discounts are a list')
  requireThat(!credit || !given.length, 'A credit carries no discounts')
  requireThat(given.length <= 5, 'An invoice carries at most five discounts')
  const items = lines.map((l, i) => l.kind === 'item' ? i + 1 : 0).filter(Boolean)
  const numbers = lines.map((_, i) => i + 1)
  let afterTax = 0
  const discounts = given.map((d: Data, n) => {
    const label = `Discount ${n + 1}`
    const type = text(d?.type, `${label} type`)
    requireThat(type === 'percent' || type === 'amount', `${label} is a percentage or an amount`)
    const chosen = d.lines === undefined || d.lines === null || d.lines === 'subtotal' ? null : d.lines
    requireThat(chosen === null || (Array.isArray(chosen) && chosen.length > 0), `${label} applies to the subtotal or to chosen lines`)
    const targets = chosen === null ? items : [...new Set((chosen as unknown[]).map(Number))].sort((a, b) => a - b)
    requireThat(targets.length && targets.every(t => numbers.includes(t)), chosen === null ? `${label} applies to the subtotal of item lines; this invoice has none` : `${label} names lines of this invoice`)
    const afterTaxDiscount = d.afterTax === true || d.afterTax === 'true'
    const remaining = targets.map(t => lines[t - 1].amount - lines[t - 1].discount)
    const base = remaining.reduce((s, x) => s + x, 0)
    const value = type === 'percent' ? milliPercent(d.value, `${label} percentage`) : cents(d.value, `${label} amount`)
    const amount = type === 'percent' ? scale(base, value, 100000) : value
    requireThat(amount > 0 && amount <= base, `${label} is more than zero and no more than the ${usd(base)} it applies to`)
    if (afterTaxDiscount) afterTax += amount
    else spreadByWeight(remaining, amount).forEach((share, i) => { lines[targets[i] - 1].discount += share })
    const scope = chosen === null ? 'subtotal' : `line${targets.length > 1 ? 's' : ''} ${targets.join(', ')}`
    return { type, value, lines: chosen === null ? null : targets, afterTax: afterTaxDiscount, amount,
      label: `Discount ${type === 'percent' ? percentLabel(value) + ' ' : ''}on ${scope}${afterTaxDiscount ? ', after tax' : ''}` } as Discount
  })
  return { discounts, afterTax }
}

/** Attribute after-tax discounts to their reviewed source lines without changing totals. */
export function afterTaxShares(lines: Data[], discounts: Discount[], fallback = 0) {
  const shares = lines.map(() => 0)
  const after = discounts.filter(d => d.afterTax)
  if (!after.length && fallback) {
    return spreadByWeight(lines.map(l => Number(l.amount_cents ?? l.amount) - Number(l.discount_cents ?? l.discount ?? 0)), fallback)
  }
  for (const d of after) {
    const targets = d.lines ?? lines.map((l, i) => (l.line_kind ?? l.kind ?? 'item') === 'item' ? i + 1 : 0).filter(Boolean)
    const parts = spreadByWeight(targets.map(n => Number(lines[n-1].amount_cents ?? lines[n-1].amount) - Number(lines[n-1].discount_cents ?? lines[n-1].discount ?? 0)), d.amount)
    targets.forEach((n,i) => { shares[n-1] += parts[i] })
  }
  return shares
}

/** A parsed discount back in the form a draft or template sends it, so a template re-parses it on every occurrence. */
export const discountInput = (d: Discount) => ({ type: d.type, value: d.type === 'percent' ? String(d.value / 1000) : (d.value / 100).toFixed(2), ...(d.lines ? { lines: d.lines } : {}), ...(d.afterTax ? { afterTax: true } : {}) })

const depositDimensions=(value:Data)=>Object.fromEntries(Object.entries(dimensionTags(value)).filter(([,name])=>name!==''))
export type Deposit = { className?:string;locationName?:string;projectName?:string; amount: number; method: string; date: string; bankAccountId: string; reference: string }

/** A deposit received when the invoice is issued: amount, method, date (on or before the issue date) and the account it went into. */
export async function parseDeposit(db: D1Database, raw: unknown, issueDate: string, total: number, credit: boolean): Promise<Deposit | null> {
  if (raw === undefined || raw === null || raw === '') return null
  requireThat(!credit, 'A credit carries no deposit')
  const d = raw as Data
  const amount = cents(d.amount, 'Deposit amount')
  requireThat(amount <= total, `The deposit is no more than the invoice total of ${usd(total)}`)
  const method = text(d.method, 'Deposit method')
  requireThat((METHODS as readonly string[]).includes(method), 'Deposit method is check, ACH, wire, cash, card or a payment network')
  const day = date(d.date ?? issueDate, 'Deposit date')
  requireThat(day <= issueDate, 'A deposit received at issue is dated on or before the issue date')
  const bank = await one(db, 'SELECT b.id FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id WHERE b.id = ? AND a.active = 1', text(d.bankAccountId, 'Deposit-to account'))
  requireThat(bank, 'Choose the active bank account the deposit went into')
  return { ...depositDimensions(d),amount, method, date: day, bankAccountId: bank.id, reference: optionalText(d.reference, 'Deposit reference', 80) }
}

/** A template keeps the deposit without a date: each invoice it creates receives it on its own issue date. */
export const depositInput = (d: Deposit | null) => d ? JSON.stringify({ ...depositDimensions(d),amount: (d.amount / 100).toFixed(2), method: d.method, bankAccountId: d.bankAccountId, ...(d.reference ? { reference: d.reference } : {}) }) : null

export const depositLabel = (d: Deposit) => `Deposit received (${d.method === 'ach' ? 'ACH' : d.method}${d.reference ? ' ' + d.reference : ''}, ${longDay(d.date)})`

export async function discountSettings(db: D1Database) {
  return await one(db, 'SELECT s.*, d.code AS discount_code, d.name AS discount_name, e.code AS early_code, e.name AS early_name FROM pt_discount_settings s LEFT JOIN pt_accounts d ON d.id = s.discount_account_id LEFT JOIN pt_accounts e ON e.id = s.early_account_id WHERE s.id = 1')
}

/** An active ordinary income (contra-revenue) or expense account. */
async function discountAccount(db: D1Database, id: string, label: string) {
  const a = await one(db, 'SELECT * FROM pt_accounts WHERE id = ?', id)
  requireThat(a && a.active && (a.type === 'income' || a.type === 'expense') && a.subtype === 'other', `${label} is an active income (contra-revenue) or expense account`)
  return a
}

const saveSettings: Command = { need: 'post', async run(c, b) {
  const current = await discountSettings(c.db)
  requireThat(!current || current.revision === b.revision, 'Discount settings changed; reload', 409)
  const discount = await discountAccount(c.db, text(b.discountAccountId, 'Discounts account'), 'The discounts account')
  const early = b.earlyAccountId ? await discountAccount(c.db, text(b.earlyAccountId, 'Early-payment discounts account'), 'The early-payment discounts account') : null
  const after = { discountAccountId: discount.id, earlyAccountId: early?.id ?? null }
  const statements: Sql[] = [authority(c.actor, 'post'),
    current ? guard('EXISTS (SELECT 1 FROM pt_discount_settings WHERE id = 1 AND revision = ?)', current.revision) : guard('NOT EXISTS (SELECT 1 FROM pt_discount_settings)'),
    q('INSERT INTO pt_discount_settings (id, discount_account_id, early_account_id, revision, updated_by, updated_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET discount_account_id = excluded.discount_account_id, early_account_id = excluded.early_account_id, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
      discount.id, early?.id ?? null, uid(), c.actor.email, now()),
    audit(who(c.actor), 'discount-settings.save', 'discount-settings', '1', { before: current ? { discountAccountId: current.discount_account_id, earlyAccountId: current.early_account_id } : null, after })]
  await run(c.db, statements)
  return (await discountSettings(c.db))!
} }

export const discountCommands: Record<string, Command> = { 'discount-settings.save': saveSettings }

export async function discountAccounts(db: D1Database) {
  return all(db, "SELECT id, code, name, type FROM pt_accounts WHERE active = 1 AND subtype = 'other' AND type IN ('income', 'expense') ORDER BY code")
}
