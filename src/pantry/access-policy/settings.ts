import { authority, who, type Role } from '../access'
import { cents, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, one, q, run } from '../db'
import type { Command } from '../context'

export const memberRoles = ['bookkeeper', 'accountant', 'viewer', 'sales', 'payables-clerk', 'time-only'] as const
export function jsonList(value: unknown, label: string): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]+/).map(v => v.trim()).filter(Boolean) : []
  requireThat(values.length <= 500 && values.every(v => typeof v === 'string' && v.length > 0 && v.length < 255), `${label} must be a list`)
  return [...new Set(values)] as string[]
}
export async function memberPolicy(db: D1Database, b: Data, previous: Data | null, role: string) {
  const banks = b.bankAccounts === undefined ? previous?.bank_accounts ?? null : b.bankAccounts === null || b.bankAccounts === 'all' ? null : JSON.stringify(jsonList(b.bankAccounts, 'Bank accounts'))
  if (banks !== null) for (const id of JSON.parse(banks)) requireThat(await one(db, 'SELECT 1 FROM pt_bank_accounts WHERE id = ?', id), 'Choose existing bank accounts')
  const people = b.timePeople === undefined ? previous?.time_people ?? '[]' : JSON.stringify(jsonList(b.timePeople, 'Time people').map(p => p.toLowerCase()))
  for (const email of JSON.parse(people)) requireThat(await one(db, "SELECT 1 FROM pt_members WHERE email = ? AND active = 1 UNION SELECT 1 FROM oa_operators WHERE lower(email) = ? AND status = 'active'", email, email), 'Choose current people for time tracking')
  const limit = (key: string, column: string) => b[key] === undefined ? previous?.[column] ?? null : b[key] === '' || b[key] === null ? null : cents(b[key], key, { zero: true })
  return { banks: role === 'sales' || role === 'time-only' ? '[]' : banks, people,
    bill: limit('billLimit', 'bill_limit_cents'), payment: limit('paymentLimit', 'payment_limit_cents'), journal: limit('journalLimit', 'journal_limit_cents') }
}
const privacySave: Command = { need: 'owner', async run(c, b) {
  const role = text(b.role, 'Role') as Role
  requireThat(memberRoles.includes(role as any), 'Choose a role')
  const before = await one(c.db, 'SELECT * FROM pt_role_privacy WHERE role = ?', role)
  requireThat(before && before.revision === b.revision, 'Privacy settings changed; reload', 409)
  const flag = (v: unknown) => v === true || v === 'on' || v === 1 ? 1 : 0
  const after = { role, mask_tin: flag(b.maskTin), mask_bank: flag(b.maskBank), revision: uid() }
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_role_privacy SET mask_tin = ?, mask_bank = ?, revision = ? WHERE role = ? AND revision = ?', after.mask_tin, after.mask_bank, after.revision, role, before.revision), changed(), audit(who(c.actor), 'role-privacy.save', 'role-privacy', role, { before, after })])
  return after
} }
export const accessPolicyCommands = { 'role-privacy.save': privacySave }
export const privacyView = (db: D1Database) => all(db, 'SELECT * FROM pt_role_privacy ORDER BY role')
