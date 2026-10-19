import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Card, command, Field, Form, today, usd, useShared, type D } from './kit'

/** A person explicitly chooses cash or owner funds; the journal approves it. */
export function ReceiptCash({ r, onChange }: { r: D; onChange: () => Promise<void> }) {
  const { state } = useShared(), [saved, setSaved] = useState<D | null>(null)
  if (!state.actor.can.record || r.status !== 'review' || r.draftProposal?.saved) return null
  const accounts = state.accounts.filter((a: D) => a.active)
  const options = (list: D[]) => list.map(a => ({ value: a.id, label: `${a.code} · ${a.name}` }))
  const total = r.total_cents ?? r.read_total_cents
  if (saved) return <Card title="Cash expense draft saved">
    <p>{saved.memo} · {usd(saved.lines.reduce((sum: number, line: D) => sum + line.debit_cents, 0))}. The receipt is attached to the draft.</p>
    <p><Link to="/app/books" onClick={() => { void onChange() }}>Review in Books → Journal entries</Link></p>
    <button type="button" className="btn btn-secondary" onClick={() => { void onChange() }}>Back to receipts</button>
  </Card>
  return <Card title="Paid with cash or owner funds?">
    <p className="hint">Choose the expense and the account that paid it. Save a journal draft for approval, with the original receipt attached.</p>
    <Form label="Save cash expense draft" className="grid-form" submit={b => command('receipt.cash-draft', { ...b, id: r.id, revision: r.revision })} onDone={setSaved}>
      <Field label="Cash receipt vendor" name="vendor" required defaultValue={r.vendor ?? r.read_vendor ?? ''} />
      <Field label="Cash receipt date" name="date" type="date" required defaultValue={r.receipt_date ?? r.read_date ?? today()} />
      <Field label="Cash receipt total" name="total" required inputMode="decimal" defaultValue={total == null ? '' : (total / 100).toFixed(2)} />
      <Field label="Cash receipt currency" name="currency" required maxLength={3} defaultValue={r.currency ?? r.read_currency ?? 'USD'} hint="Cash expense drafts use USD." />
      <Field label="Cash expense account" name="accountId" required defaultValue={r.account_id ?? r.read_account_id ?? ''} options={options(accounts.filter((a: D) => a.type === 'expense'))} />
      <Field label="Cash paid from" name="fundingAccountId" required options={options(accounts.filter((a: D) => ['asset', 'equity'].includes(a.type) && !['receivable', 'payable', 'retained'].includes(a.subtype)))} hint="Choose cash on hand or the owner's contribution account." />
    </Form>
  </Card>
}
