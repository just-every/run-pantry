// Chart of accounts and sales tax codes.
import { authority, who } from './access'
import { optionalText, requireThat, text, uid, type Data } from './core'
import { all, audit, changed, one, q, run, type Sql } from './db'
import type { Command } from './context'
import { STATES } from './states'

export const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const
export const SUBTYPES = ['bank', 'receivable', 'payable', 'tax', 'retained', 'other'] as const
const SUBTYPE_TYPE: Record<string, string> = { receivable: 'asset', payable: 'liability', tax: 'liability', retained: 'equity' }

/** A small service-business chart a person can start from and edit. */
export const SERVICE_CHART: [string, string, string, string][] = [
  ['1000', 'Operating checking', 'asset', 'bank'],
  ['1200', 'Accounts receivable', 'asset', 'receivable'],
  ['1500', 'Equipment', 'asset', 'other'],
  ['2000', 'Accounts payable', 'liability', 'payable'],
  ['2100', 'Credit card', 'liability', 'other'],
  ['2200', 'Sales tax payable', 'liability', 'tax'],
  ['3000', "Owner's equity", 'equity', 'other'],
  ['3900', 'Retained earnings', 'equity', 'retained'],
  ['4000', 'Service revenue', 'income', 'other'],
  ['4900', 'Interest income', 'income', 'other'],
  ['6000', 'Contractors', 'expense', 'other'],
  ['6100', 'Rent', 'expense', 'other'],
  ['6200', 'Software and subscriptions', 'expense', 'other'],
  ['6300', 'Office supplies', 'expense', 'other'],
  ['6400', 'Bank fees', 'expense', 'other'],
  ['6500', 'Professional fees', 'expense', 'other'],
]

export function accountRow(b: Data) {
  const code = text(b.code, 'Account code', 20)
  requireThat(/^[A-Za-z0-9.-]+$/.test(code), 'Account code uses letters, digits, dots or dashes')
  const type = text(b.type, 'Account type')
  requireThat((TYPES as readonly string[]).includes(type), 'Account type is asset, liability, equity, income or expense')
  const subtype = optionalText(b.subtype, 'Account role') || 'other'
  requireThat((SUBTYPES as readonly string[]).includes(subtype), 'Unknown account role')
  // A bank role is an asset (checking, savings) or a liability (a business credit card).
  requireThat(subtype !== 'bank' || type === 'asset' || type === 'liability', 'A bank or card account must be an asset or liability account')
  requireThat(!SUBTYPE_TYPE[subtype] || SUBTYPE_TYPE[subtype] === type, `A ${subtype} account must be a${SUBTYPE_TYPE[subtype] === 'asset' ? 'n' : ''} ${SUBTYPE_TYPE[subtype]} account`)
  return { code, name: text(b.name, 'Account name', 200), type, subtype, description: optionalText(b.description, 'Description', 500) }
}

export async function account(db: D1Database, id: string) {
  const row = await one(db, 'SELECT * FROM pt_accounts WHERE id = ?', id)
  requireThat(row, 'Account not found', 404)
  return row
}

export async function controlAccount(db: D1Database, subtype: 'receivable' | 'payable' | 'retained') {
  const row = await one(db, 'SELECT * FROM pt_accounts WHERE subtype = ? AND active = 1', subtype)
  requireThat(row, `Add ${subtype === 'receivable' ? 'an accounts receivable' : subtype === 'payable' ? 'an accounts payable' : 'a retained earnings'} account to the chart first`, 409)
  return row
}

export const accountInsert = (id: string, a: ReturnType<typeof accountRow>): Sql =>
  q('INSERT INTO pt_accounts (id, code, name, type, subtype, description, active, revision) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', id, a.code, a.name, a.type, a.subtype, a.description, uid())

const saveAccount: Command = { need: 'record', async run(c, b) {
  const a = accountRow(b), id = b.id ? text(b.id, 'Account') : uid()
  const statements: Sql[] = [authority(c.actor, 'record')]
  if (b.id) {
    const current = await account(c.db, id)
    requireThat(current.revision === b.revision, 'Account changed; reload', 409)
    const used = await one(c.db, 'SELECT 1 FROM pt_journal_lines WHERE account_id = ? LIMIT 1', id)
    requireThat(!used || (current.type === a.type && current.subtype === a.subtype), 'An account with postings keeps its type and role; add a new account instead', 409)
    const active = b.active === false || b.active === 'false' ? 0 : 1
    statements.push(q('UPDATE pt_accounts SET code = ?, name = ?, type = ?, subtype = ?, description = ?, active = ?, revision = ? WHERE id = ? AND revision = ?', a.code, a.name, a.type, a.subtype, a.description, active, uid(), id, b.revision), changed())
  } else statements.push(accountInsert(id, a))
  statements.push(audit(who(c.actor), b.id ? 'account.update' : 'account.create', 'account', id, a))
  await run(c.db, statements)
  return account(c.db, id)
} }

const startChart: Command = { need: 'record', async run(c) {
  const existing = await one(c.db, 'SELECT COUNT(*) AS n FROM pt_accounts')
  requireThat(Number(existing?.n) === 0, 'The chart already has accounts', 409)
  await run(c.db, [authority(c.actor, 'record'), q('INSERT INTO pt_guard SELECT CASE WHEN (SELECT COUNT(*) FROM pt_accounts) = 0 THEN 1 ELSE 0 END'),
    ...SERVICE_CHART.map(([code, name, type, subtype]) => accountInsert(uid(), { code, name, type, subtype, description: '' })),
    audit(who(c.actor), 'chart.start', 'chart', 'service-business', { accounts: SERVICE_CHART.length })])
  return { accounts: await all(c.db, 'SELECT * FROM pt_accounts ORDER BY code') }
} }

/** A sales tax code is a rate in one state. Once saved its rate and account stay; its name and state can be corrected. */
const saveTaxCode: Command = { need: 'post', async run(c, b) {
  const name = text(b.name, 'Tax code name', 100)
  // A code is in the business's own state unless another state is chosen.
  const state = (optionalText(b.state, 'State', 2) || (await one(c.db, 'SELECT state FROM pt_entity WHERE id = 1'))?.state || '').toUpperCase()
  requireThat(STATES.includes(state), 'Choose the state this tax is collected for (two-letter code)')
  if (b.id) {
    const current = await one(c.db, 'SELECT * FROM pt_tax_codes WHERE id = ?', text(b.id, 'Tax code'))
    requireThat(current, 'Tax code not found', 404)
    requireThat(current.revision === b.revision, 'Tax code changed; reload', 409)
    await run(c.db, [authority(c.actor, 'post'), q('UPDATE pt_tax_codes SET name = ?, state = ?, revision = ? WHERE id = ? AND revision = ?', name, state, uid(), current.id, b.revision), changed(),
      audit(who(c.actor), 'tax-code.update', 'tax-code', current.id, { name, state })])
    return (await one(c.db, 'SELECT * FROM pt_tax_codes WHERE id = ?', current.id))!
  }
  const rate = text(String(b.rate ?? ''), 'Rate')
  requireThat(/^\d{1,2}(\.\d{1,3})?$/.test(rate), 'Rate is a percentage with up to three decimals, like 8.875')
  const [w, f = ''] = rate.split('.'), milli = Number(w) * 1000 + Number(f.padEnd(3, '0'))
  const liability = await account(c.db, text(b.accountId, 'Sales tax account'))
  requireThat(liability.subtype === 'tax', 'Choose a sales tax liability account')
  const id = uid()
  await run(c.db, [authority(c.actor, 'post'), q('INSERT INTO pt_tax_codes (id, name, rate_milli_percent, account_id, state, active, revision) VALUES (?, ?, ?, ?, ?, 1, ?)', id, name, milli, liability.id, state, uid()),
    audit(who(c.actor), 'tax-code.create', 'tax-code', id, { name, rate, state })])
  return (await one(c.db, 'SELECT * FROM pt_tax_codes WHERE id = ?', id))!
} }

export const accountCommands: Record<string, Command> = {
  'account.save': saveAccount,
  'chart.start': startChart,
  'tax-code.save': saveTaxCode,
}
