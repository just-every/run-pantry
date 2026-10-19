import { authority, who } from '../access'
import type { Command } from '../context'
import { list, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run } from '../db'

export const CSV_FIELDS = ['account', 'number', 'date', 'amount', 'payee', 'status', 'memo'] as const
export type PayFormat = { name: string; account: string; columns: { field: string; header: string }[]; header: boolean; delimiter: string; dateFormat: string; amountFormat: string; issueCode: string; voidCode: string }

export function parseFormat(value: Data): PayFormat {
  requireThat(value && typeof value === 'object', 'Enter the positive-pay format supplied by your bank')
  const columns = list<Data>(value.columns, 'Positive-pay columns', 12).map(c => {
    requireThat(c && typeof c === 'object', 'Each positive-pay column needs a field and heading')
    requireThat((CSV_FIELDS as readonly string[]).includes(c.field), 'Choose a supported positive-pay field')
    return { field: c.field as string, header: text(c.header, 'Column heading', 80) }
  })
  requireThat(['number', 'amount', 'date', 'status'].every(f => columns.some(c => c.field === f)), 'Positive pay needs check number, amount, date and issue/void status columns')
  requireThat(new Set(columns.map(c => c.field)).size === columns.length, 'Each positive-pay field appears once')
  requireThat([',', ';', '\t'].includes(value.delimiter), 'Delimiter is comma, semicolon or tab')
  requireThat(['YYYY-MM-DD', 'MM/DD/YYYY', 'MMDDYYYY', 'YYYYMMDD'].includes(value.dateFormat), 'Choose the bank date format')
  requireThat(['decimal', 'cents'].includes(value.amountFormat), 'Amounts are decimal dollars or integer cents')
  requireThat(typeof value.header === 'boolean', 'Choose whether the bank expects a heading row')
  const issueCode = text(value.issueCode, 'Issue code', 20), voidCode = text(value.voidCode, 'Void code', 20)
  requireThat(issueCode !== voidCode, 'Issue and void codes must differ')
  return { name: text(value.name, 'Bank format name', 100), account: text(value.account, 'Bank-provided account identifier', 100), columns,
    delimiter: value.delimiter, header: value.header, dateFormat: value.dateFormat, amountFormat: value.amountFormat, issueCode, voidCode }
}

export async function payingBank(db: D1Database, id: string) {
  const bank = await one(db, 'SELECT b.*, a.type, a.active FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id WHERE b.id = ?', id)
  requireThat(bank && bank.active && bank.type === 'asset', 'Choose an active checking account', 400)
  return bank
}

export const saveSettings: Command = { need: 'record', async run(c, b) {
  const bank = await payingBank(c.db, text(b.bankAccountId, 'Bank account'))
  const next = Number(b.nextNumber)
  requireThat(Number.isSafeInteger(next) && next > 0 && next <= 999999998, 'Next check number is a whole number from 1 to 999999998')
  requireThat(['voucher', 'three-per-page'].includes(b.stock), 'Choose voucher or three-per-page stock')
  const x = Number(b.offsetXmm ?? 0), y = Number(b.offsetYmm ?? 0)
  requireThat(Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 20 && Math.abs(y) <= 20, 'Alignment offsets must be within 20 mm')
  const format = parseFormat(b.positivePay), current = await one(c.db, 'SELECT * FROM pt_check_profiles WHERE bank_account_id = ?', bank.id)
  requireThat(!current || current.revision === b.revision, 'Check setup changed; reload', 409)
  const highest = Number((await one(c.db, 'SELECT COALESCE(MAX(number), 0) AS n FROM pt_checks WHERE bank_account_id = ?', bank.id))!.n)
  requireThat(next > highest && (!current || next >= current.next_number), 'Check numbers cannot be reused or moved backwards', 409)
  const revision = uid()
  await run(c.db, [authority(c.actor, 'record'),
    guard('NOT EXISTS (SELECT 1 FROM pt_checks WHERE bank_account_id = ? AND number >= ?)', bank.id, next),
    ...(current ? [q('UPDATE pt_check_profiles SET next_number = ?, stock = ?, offset_x_mm = ?, offset_y_mm = ?, positive_pay = ?, revision = ? WHERE bank_account_id = ? AND revision = ? AND next_number <= ?', next, b.stock, x, y, JSON.stringify(format), revision, bank.id, b.revision, next), changed()]
      : [q('INSERT INTO pt_check_profiles (bank_account_id, next_number, stock, offset_x_mm, offset_y_mm, positive_pay, revision) VALUES (?, ?, ?, ?, ?, ?, ?)', bank.id, next, b.stock, x, y, JSON.stringify(format), revision)]),
    audit(who(c.actor), 'check.settings', 'bank-account', bank.id, { next, stock: b.stock, offsetXmm: x, offsetYmm: y, format: format.name })])
  return { bankAccountId: bank.id, revision }
} }

export async function profiles(db: D1Database) {
  return (await all(db, 'SELECT * FROM pt_check_profiles')).map(p => ({ ...p, positive_pay: JSON.parse(p.positive_pay) }))
}
