// ITEM-001: the products and services list. An item carries the description,
// default rate, income account and sales-tax category an invoice line takes
// when it is sold. Names and SKUs are unique, ignoring case.
import { authority, who } from '../access'
import { cents, now, optionalText, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, one, q, run } from '../db'
import type { Command } from '../context'

export async function item(db: D1Database, id: string) {
  const row = await one(db, 'SELECT * FROM pt_items WHERE id = ?', id)
  requireThat(row, 'Product or service not found', 404)
  return row
}

export const itemsView = (db: D1Database) => all(db, 'SELECT * FROM pt_items ORDER BY active DESC, lower(name)')

const save: Command = { need: 'record', async run(c, b) {
  const name = text(b.name, 'Name', 200), kind = text(b.kind ?? 'service', 'Kind')
  requireThat(kind === 'service' || kind === 'non-inventory', 'An item is a service or a non-inventory product; stock is kept in Pier')
  const sku = optionalText(b.sku, 'SKU', 64) || null, description = optionalText(b.description, 'Description', 500)
  const rate = cents(b.rate ?? '0', 'Default rate', { zero: true })
  const account = await one(c.db, 'SELECT id, type, active FROM pt_accounts WHERE id = ?', text(b.accountId, 'Income account'))
  requireThat(account && account.active && account.type === 'income', 'Choose an active income account')
  const category = text(b.taxCategory, 'Sales tax category')
  requireThat(category === 'taxable' || category === 'non-taxable', 'The sales tax category is taxable or not taxable')
  const code = category === 'taxable' && typeof b.taxCode === 'string' && b.taxCode ? b.taxCode : null
  requireThat(!code || await one(c.db, 'SELECT 1 FROM pt_tax_codes WHERE id = ? AND active = 1', code), 'Choose an active sales tax code')
  const active = b.active === false || b.active === 'false' ? 0 : 1
  const clash = await one(c.db, 'SELECT name, sku FROM pt_items WHERE id <> ? AND (lower(name) = lower(?) OR (? IS NOT NULL AND lower(sku) = lower(?)))', String(b.id ?? ''), name, sku, sku)
  requireThat(!clash, clash && clash.name.toLowerCase() === name.toLowerCase() ? `${clash.name} is already on the list` : `SKU ${sku} is already used by ${clash?.name}`, 409)
  const fields: Data = { name, kind, sku, description, rate, accountId: account.id, category, code, active }
  if (b.id) {
    const current = await item(c.db, text(b.id, 'Product or service'))
    requireThat(current.revision === b.revision, 'Product or service changed; reload', 409)
    await run(c.db, [authority(c.actor, 'record'),
      q('UPDATE pt_items SET name = ?, kind = ?, sku = ?, description = ?, rate_cents = ?, income_account_id = ?, tax_category = ?, tax_code = ?, active = ?, revision = ? WHERE id = ? AND revision = ?',
        name, kind, sku, description, rate, account.id, category, code, active, uid(), current.id, b.revision), changed(),
      audit(who(c.actor), current.active && !active ? 'item.deactivate' : !current.active && active ? 'item.reactivate' : 'item.update', 'item', current.id, fields)])
    return item(c.db, current.id)
  }
  const id = uid()
  await run(c.db, [authority(c.actor, 'record'),
    q('INSERT INTO pt_items (id, name, kind, sku, description, rate_cents, income_account_id, tax_category, tax_code, active, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, name, kind, sku, description, rate, account.id, category, code, active, uid(), now()),
    audit(who(c.actor), 'item.create', 'item', id, fields)])
  return item(c.db, id)
} }

export const itemCommands: Record<string, Command> = { 'item.save': save }
