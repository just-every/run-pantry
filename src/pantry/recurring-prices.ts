import { dimensionTags } from './dimensions'
import { withinLimit } from './issuing-limits'
// Price revisions have their own approval: scheduling one never revokes the
// original template's authority for occurrences before its effective date.
import { authority, who } from './access'
import { date, now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, approval, audit, changed, guard, one, q, run } from './db'
import { parseInvoice } from './invoices'
import { template } from './recurring'
import type { Command } from './context'

export const amountSnapshot = (p: Awaited<ReturnType<typeof parseInvoice>>) => JSON.stringify(p.lines.map(l => [l.amount, l.tax]))

export async function pricesFor(db: D1Database, id: string) {
  const prices = await all(db, 'SELECT * FROM pt_recurring_prices WHERE recurring_id = ? ORDER BY effective_date', id)
  for (const price of prices) price.lines = JSON.parse(price.lines)
  return prices
}

/** Fence both selection and approval so an overlapping edit cannot send stale prices. */
export function priceFence(t: Data, price: Data | undefined, occurrence: string) {
  return guard(`(SELECT id FROM pt_recurring_prices WHERE recurring_id = ? AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1) IS ?
    AND NOT EXISTS (SELECT 1 FROM pt_recurring_prices WHERE id = ? AND (revision <> ? OR approved_revision IS NOT ? OR template_revision IS NOT ?))`,
  t.id, occurrence, price?.id ?? null, price?.id ?? null, price?.revision ?? null, price?.approved_revision ?? null, price?.template_revision ?? null)
}

const schedule: Command = { need: 'record', async run(c, b) {
  const t = await template(c.db, text(b.id, 'Recurring invoice'))
  requireThat(t.revision === b.revision, 'Recurring invoice changed; reload', 409)
  requireThat(t.status !== 'ended', 'This recurring invoice has ended; start a new one', 409)
  const effective = date(b.effectiveDate, 'Price takes effect from')
  requireThat(effective >= t.start_date && (!t.end_date || effective <= t.end_date), 'Choose a price date within the recurring schedule')
  requireThat(!await one(c.db, 'SELECT 1 FROM pt_recurring_runs WHERE recurring_id = ? AND occurrence >= ?', t.id, effective), 'Invoices have already been generated on or after that date; choose a later price date', 409)
  const p = await parseInvoice(c.db, { customerId: t.customer_id, issueDate: effective, lines: b.lines, memo: t.memo, discounts: t.discounts, deposit: t.deposit })
  requireThat(p.lines.every(l => l.taxCode), 'Choose a sales tax code or exemption for every line')
  const lines = p.lines.map(l => ({ ...dimensionTags(l),description: l.description, quantity: String(l.qty / 1000), rate: (l.unit / 100).toFixed(2), accountId: l.accountId, taxCode: l.taxCode, ...(l.itemId ? { itemId: l.itemId } : {}), ...(l.kind === 'delivery' ? { kind: 'delivery' } : {}) }))
  const id = uid(), revision = uid()
  await run(c.db, [authority(c.actor, 'record'),
    guard("EXISTS (SELECT 1 FROM pt_recurring WHERE id = ? AND revision = ? AND status <> 'ended')", t.id, t.revision),
    guard('NOT EXISTS (SELECT 1 FROM pt_recurring_runs WHERE recurring_id = ? AND occurrence >= ?)', t.id, effective),
    q('INSERT INTO pt_recurring_prices (id, recurring_id, effective_date, lines, amount_snapshot, subtotal_cents, tax_cents, total_cents, prepared_by, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, t.id, effective, JSON.stringify(lines), amountSnapshot(p), p.subtotal, p.tax, p.total, c.actor.email, revision, now()),
    audit(who(c.actor), 'recurring.price', 'recurring', t.id, { price: id, effectiveDate: effective, total: p.total })])
  return { ...(await one(c.db, 'SELECT * FROM pt_recurring_prices WHERE id = ?', id)), lines }
} }

const approve: Command = { need: 'post', async run(c, b) {
  const price = await one(c.db, 'SELECT * FROM pt_recurring_prices WHERE id = ?', text(b.id, 'Price change'))
  requireThat(price, 'Price change not found', 404)
  const t = await template(c.db, price.recurring_id)
  requireThat(t.status !== 'ended' && t.mode === 'send' && t.approved_revision === t.revision, 'Approve the sending template before its price change', 409)
  requireThat(price.revision === b.revision && t.revision === b.templateRevision, 'Recurring invoice or price changed since you reviewed it; review it again', 409)
  requireThat(price.approved_revision !== price.revision || price.template_revision !== t.revision, 'This price change is already approved', 409)
  const self = c.actor.kind === 'person' && c.actor.role !== 'owner' && price.prepared_by === c.actor.email ? await withinLimit(c.db, c.actor, { ...price, kind: 'invoice' }, b.limitRevision) : null
  const p = await parseInvoice(c.db, { customerId: t.customer_id, issueDate: price.effective_date, lines: JSON.parse(price.lines), memo: t.memo, discounts: t.discounts, deposit: t.deposit })
  requireThat(p.total === price.total_cents && amountSnapshot(p) === price.amount_snapshot, 'The price amounts changed; schedule the current amounts before approval', 409)
  await run(c.db, [authority(c.actor, 'post'), ...(self?.fences ?? []),
    guard("EXISTS (SELECT 1 FROM pt_recurring WHERE id = ? AND revision = ? AND approved_revision = revision AND status <> 'ended')", t.id, t.revision),
    q('UPDATE pt_recurring_prices SET approved_by = ?, approved_revision = revision, template_revision = ? WHERE id = ? AND revision = ?', c.actor.email, t.revision, price.id, b.revision), changed(),
    approval(who(c.actor), 'recurring-price', price.id, price.revision, 'approve', 'approved', self ? self.note : optionalText(b.note, 'Note', 500)),
    audit(who(c.actor), 'recurring.price-approve', 'recurring', t.id, { price: price.id, effectiveDate: price.effective_date, ...(self?.detail ?? {}) })])
  return { ...(await one(c.db, 'SELECT * FROM pt_recurring_prices WHERE id = ?', price.id)), lines: JSON.parse(price.lines) }
} }

export const recurringPriceCommands: Record<string, Command> = {
  'recurring.price': schedule,
  'recurring.approve-price': approve,
}
