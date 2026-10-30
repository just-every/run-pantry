import { Card, command, Field, Form, usd, useShared, type D } from './kit'
export function CaptureApprovalRules({ rules, accounts, onChange }: { rules: D[]; accounts: D[]; onChange: () => Promise<void> }) {
  const { state } = useShared()
  return <Card title="Bill and document approval">
    <p>A document draft must be approved before it is recorded. The approver needs permission to post and must review it again after any change. These rules require the owner for matching manual bills and document drafts. Manual bills without a matching rule may post directly. </p>
    {rules.map(r => <p key={r.id}>Owner required from {usd(r.minimum_cents)}{r.vendor_id ? ` for ${state.contacts.find((c: D) => c.id === r.vendor_id)?.name}` : ''}{r.account_id ? ` coded to ${accounts.find(a => a.id === r.account_id)?.name}` : ''}{r.class_name ? ` in class ${r.class_name}` : ''}.</p>)}
    {state.actor.can.owner && <Form label="Require owner approval" submit={b => command('capture-approval-rule.save', b)} onDone={onChange} className="grid-form">
      <Field label="Minimum bill or document amount" name="minimum" inputMode="decimal" required />
      <Field label="Rule vendor" name="vendorId" empty="Any vendor" options={state.contacts.filter((c: D) => c.kind === 'vendor').map((c: D) => ({ value: c.id, label: c.name }))} />
      <Field label="Rule account" name="accountId" empty="Any account" options={accounts.map(a => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
      <Field label="Rule class" name="className" hint="Leave blank for any class" />
    </Form>}
  </Card>
}
