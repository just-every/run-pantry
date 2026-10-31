import { useRef } from 'react'
import { DimensionFormFields } from './dimensions'
import { Card, command, Field, Form, Loading, today, useShared, useView, type D } from './kit'
import { Help } from './help'

export function LateFeeSettings() {
  const { state } = useShared(), { data, error, reload } = useView<D>(state.actor.can.owner ? 'late-fees' : null)
  if (!state.actor.can.owner) return null
  if (!data) return <Loading error={error} what="late-fee policy" />
  const p = data.policy
  return <Card title="Late-fee policy">
    <Help label="How late fees work"><p>Late fees are off until you enable them. Decide with your accountant what your state allows. Preparing a fee creates a separate invoice draft for review and approval.</p></Help>
    <Form key={p.revision} label="Save late-fee policy" submit={b => command('late-fee-policy.save', { ...b, enabled: b.enabled === 'on', revision: p.revision })} onDone={reload} className="grid-form">
      <label className="check"><input name="enabled" type="checkbox" defaultChecked={p.enabled} /> Allow late-fee drafts</label>
      <Field label="Late-fee method" name="method" defaultValue={p.method} required options={[{ value: 'percentage', label: 'Percentage of open invoice balance' }, { value: 'flat', label: 'Flat amount' }]} />
      <Field label="Late-fee percentage" name="percentage" type="number" step="0.001" min="0" defaultValue={p.percentage || ''} />
      <Field label="Flat late fee" name="flatAmount" type="number" step="0.01" min="0" defaultValue={p.flatAmount || ''} />
      <Field label="Days overdue before a fee" name="graceDays" type="number" min="0" defaultValue={p.graceDays} required />
      <Field label="Late-fee income account" name="incomeAccountId" defaultValue={p.incomeAccountId} options={data.accounts.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
      <Field label="Late-fee tax treatment" name="taxCode" defaultValue={p.taxCode ?? ''} empty="Review on each draft" options={[{ value: 'exempt', label: 'No tax (explicitly exempt)' }, ...data.taxCodes.map((t: D) => ({ value: t.id, label: t.name }))]} hint="An undecided tax treatment must be resolved on the fee draft before approval." />
    </Form>
  </Card>
}

export function LateFeeCharge({ invoice, onChange }: { invoice: D; onChange: () => Promise<void> }) {
  const { state } = useShared(), { data } = useView<D>(state.actor.can.record && state.actor.policy?.bankAccounts == null ? 'late-fees' : null), key = useRef(crypto.randomUUID())
  if (!state.actor.can.record || state.actor.policy?.bankAccounts != null || !data?.policy.enabled || invoice.kind === 'credit') return null
  return <details className="details"><summary>Prepare a late fee</summary>
    <p>This prepares a separate invoice draft. Review and approve it before issuing or sending it.</p>
    <Form label="Prepare late-fee draft" submit={b => command('late-fee.prepare', { ...b, invoiceId: invoice.id, idempotencyKey: key.current })} onDone={async result => { await onChange(); window.location.assign(`/app/sales?invoice=${encodeURIComponent(result.invoiceId)}`) }}>
      <Field label="Late-fee date" name="date" type="date" defaultValue={today()} required />
      <DimensionFormFields label="Late fee" />
    </Form>
  </details>
}
