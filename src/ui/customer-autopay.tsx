import { Action, Card, Chip, command, day, Field, Form, Loading, Table, useShared, useView, type D } from './kit'

export function CustomerAutopay({ customerId }: { customerId: string }) {
  const { state } = useShared()
  const { data, error, reload } = useView<D>(state.actor.can.owner ? `autopay/${encodeURIComponent(customerId)}` : null)
  const { data: sales } = useView<D>(state.actor.can.owner ? 'sales' : null)
  if (!state.actor.can.owner) return null
  if (!data) return <Card title="Saved payment and autopay"><Loading error={error} what="autopay" /></Card>
  const p = data.policy, saved = data.saved
  const templates = (sales?.recurring ?? []).filter((r: D) => r.customer_id === customerId && r.status === 'active' && r.mode === 'send')
  return <Card title="Saved payment and autopay" actions={<Chip tone={saved?.active ? 'good' : 'neutral'}>{saved?.active ? 'Authorized' : 'Off'}</Chip>}>
    {saved && <dl className="facts"><div><dt>Saved method</dt><dd>{saved.method === 'card' ? 'Card' : 'ACH bank account'} ending {saved.last4}</dd></div><div><dt>Customer authorization</dt><dd>{day(saved.acceptedAt)}{saved.acceptedIP && <> · IP {saved.acceptedIP}</>}{saved.revokedAt && <> · {saved.revokedAt === 'restored' ? 'Restored: new authorization required' : <>Revoked {day(saved.revokedAt)}</>}</>}</dd></div></dl>}
    {p && <p>{p.valid ? 'Approved schedule' : 'Schedule needs fresh approval'} · {p.purpose}. Retry days: {p.retryDays.join(', ')}.</p>}
    <details className="details"><summary>Authorization and schedule</summary>
      {saved?.mandateText && <p>{saved.mandateText}</p>}
      <p>The customer saves their method on a sent invoice’s page. Owner approval applies to the selected recurring template, its current schedule and this customer’s billing address and email.</p>
      <p><strong>Retry email subject:</strong> {data.notice.subject}</p><pre style={{whiteSpace:"pre-wrap"}}>{data.notice.body}</pre>
      <Form label="Approve autopay schedule" submit={b => command('autopay.policy', { customerId, recurringId: b.recurringId, purpose: b.purpose, retryDays: String(b.retryDays).split(',').filter(Boolean).map(Number), consent: b.consent === 'on', enabled: true })} onDone={reload}>
        <Field label="Recurring template" name="recurringId" required defaultValue={p?.recurring_id} options={templates.map((r: D) => ({ value: r.id, label: `${r.number} · ${r.customer_name}` }))} />
        <Field label="Charge purpose" name="purpose" required defaultValue={p?.purpose} />
        <Field label="Retry days after first attempt" name="retryDays" required defaultValue={p?.retryDays.join(', ') ?? '1, 3, 7'} />
        <label className="check"><input type="checkbox" name="consent" required /> I approve this schedule and the retry email template above for this customer.</label>
      </Form>
    </details>
    {p?.enabled && <Action tone="danger" run={async () => { await command('autopay.policy', { customerId, enabled: false }); await reload() }}>Disable scheduled charges</Action>}
    {saved && !saved.revokedAt && <Action tone="danger" run={async () => { await command('autopay.revoke', { customerId }); await reload() }}>Revoke autopay</Action>}
    {data.attempts.length > 0 && <Table heads={['Invoice', 'Date', 'Attempt', 'Outcome']} empty="No automatic charges yet.">{data.attempts.map((a: D) => <tr key={a.id}><td><a href={`/app/sales?invoice=${encodeURIComponent(a.invoice_id)}`}>{a.invoice_number}</a></td><td>{day(a.attempted_on)}</td><td>{a.sequence === 0 ? 'Due date' : `Retry ${a.sequence}`}</td><td><Chip>{a.status}</Chip>{a.failure_code && <p>{a.failure_code}</p>}</td></tr>)}</Table>}
    {data.notices.length > 0 && <details className="details"><summary>Retry email outcomes</summary><Table heads={['When', 'Recipient', 'Outcome']}>{data.notices.map((n: D) => <tr key={n.id}><td>{day(n.at)}</td><td>{n.recipient}</td><td>{n.status}</td></tr>)}</Table></details>}
  </Card>
}
