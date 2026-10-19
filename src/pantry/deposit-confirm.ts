// Confirm the displayed invoice against today's books, then record and match once.
import { authority } from './access'
import { depositProposals } from './automatch'
import { requireThat, text } from './core'
import { one, run } from './db'
import { matchPlan } from './matching'
import type { Command } from './context'

const confirm: Command = { need: 'record', async run(c, b) {
  const id = text(b.lineId, 'Deposit'), invoiceId = text(b.invoiceId, 'Invoice')
  const line = await one(c.db, 'SELECT * FROM pt_bank_lines WHERE id = ? AND removed_at IS NULL', id)
  requireThat(line, 'Deposit not found', 404)
  const proposed = (await depositProposals(c.db, [line]))[id]
  requireThat(proposed && proposed.invoiceId === invoiceId, 'The proposed invoice changed; reload and review this deposit', 409)
  const amount = (line.amount_cents / 100).toFixed(2)
  const plan = await matchPlan(c.db, c.actor, { bankLineIds: [id], journalLineIds: [],
    create: [{ type: 'receipt', contactId: proposed.customerId, amount, date: line.posted_date,
      reference: line.reference || proposed.invoice, memo: `Confirmed deposit for ${proposed.invoice}`, allocations: [{ targetId: invoiceId, amount }] }],
    note: `Confirmed: ${proposed.customer} pays ${proposed.invoice}` }, { recordedReceipt: true })
  await run(c.db, [authority(c.actor, 'record'), ...plan.statements])
  return { id: plan.id }
} }

export const depositCommands: Record<string, Command> = { 'deposit.confirm': confirm }
