import { useState } from 'react'
import { Action, Card, Chip, command, Field, Form, Loading, Table, useShared, useView, type D } from './kit'

type Subscription = { id: string; destination: string; host: string; events: string[]; enabled: boolean; revision: string; createdAt: string }
type Attempt = { eventId: string; eventType: string; record: { kind: string; id: string; revision: string; status: string }; host: string; attempt: number; at: string; outcome: string; statusCode: number | null; errorClass: string | null; durationMs: number | null }
type Webhooks = { subscriptions: Subscription[]; history: Attempt[]; eventTypes: string[]; payloadFields: string[] }
type IssuedSecret = { host: string; secret: string }

function SubscriptionForm({ subscription, eventTypes, submit, done, cancel }: {
  subscription: Subscription | null; eventTypes: string[]; submit: (body: D) => Promise<D>; done: (result: D) => Promise<void>; cancel: () => void
}) {
  const [events, setEvents] = useState(subscription?.events ?? [])
  return <Form label={subscription ? 'Save webhook' : 'Create webhook'} className="grid-form" submit={body => {
    if (!events.length) throw new Error('Choose at least one event type.')
    return submit({ destination: String(body.destination).trim(), events })
  }} onDone={done} secondary={subscription && <button type="button" className="btn btn-secondary" onClick={cancel}>Cancel edit</button>}>
    <Field label="Webhook destination" name="destination" type="url" required defaultValue={subscription?.destination} hint="Use HTTPS on the default port with a public DNS host name. Local names, IP addresses, URL credentials and fragments are refused." wide />
    <fieldset className="checks field-wide"><legend>Webhook events</legend>
      {eventTypes.map(event => <label key={event}><input type="checkbox" name={`event-${event}`} checked={events.includes(event)} onChange={e => setEvents(current => e.target.checked ? [...current, event] : current.filter(value => value !== event))} />{event}</label>)}
    </fieldset>
  </Form>
}

function SecretPanel({ issued, dismiss }: { issued: IssuedSecret; dismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return <section aria-label="One-time webhook secret" className="callout callout-warn" role="status">
    <strong>Save the signing secret for {issued.host} now.</strong>
    <code className="token" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{issued.secret}</code>
    <span>This secret is shown once. Keep it in your receiver’s private configuration. Leaving, refreshing or changing a webhook clears it.</span>
    <div className="row-actions"><Action run={async () => { await navigator.clipboard.writeText(issued.secret); setCopied(true) }}>{copied ? 'Copied' : 'Copy signing secret'}</Action><button type="button" className="btn btn-secondary" onClick={dismiss}>I saved the secret</button></div>
  </section>
}

function DeliveryHistory({ history }: { history: Attempt[] }) {
  return <Table caption="Webhook delivery attempts" heads={['Time / destination', 'Event / record', 'Attempt', 'Result']} empty="No webhook delivery attempts yet.">
    {history.map((attempt, index) => <tr key={`${attempt.eventId}-${attempt.host}-${attempt.attempt}-${index}`}>
      <td><time dateTime={attempt.at}>{new Date(attempt.at).toLocaleString()}</time><small className="sub block" style={{ overflowWrap: 'anywhere' }}>{attempt.host}</small></td>
      <td style={{ overflowWrap: 'anywhere' }}>{attempt.eventType}<small className="sub block">Event {attempt.eventId}</small><small className="sub block">{attempt.record.kind} {attempt.record.id}</small><small className="sub block">Revision {attempt.record.revision} · {attempt.record.status}</small></td>
      <td>{attempt.attempt}</td>
      <td>{attempt.outcome}{attempt.statusCode != null && <small className="sub block">HTTP {attempt.statusCode}</small>}{attempt.errorClass && <small className="sub block">{attempt.errorClass}</small>}{attempt.durationMs != null && <small className="sub block">{attempt.durationMs} ms</small>}</td>
    </tr>)}
  </Table>
}

export function WebhookSettings() {
  const owner = useShared().state.actor.can.owner
  const { data, error, reload } = useView<Webhooks>(owner ? 'webhooks' : null)
  const [editing, setEditing] = useState<Subscription | null>(null), [generation, setGeneration] = useState(0)
  const [issued, setIssued] = useState<IssuedSecret | null>(null)
  if (!owner) return null
  const change = async (operation: string, body: D) => {
    setIssued(null)
    return command(operation, body)
  }
  const done = async (result: D) => {
    setEditing(null); setGeneration(value => value + 1)
    setIssued(result.secret ? { host: result.host, secret: result.secret } : null)
    await reload()
  }
  const refresh = async () => { setIssued(null); setEditing(null); setGeneration(value => value + 1); await reload() }
  return <>
    <Card title="Webhooks" actions={<Action run={refresh}>Refresh webhooks</Action>}>
      <p>Notify your receiver when records change. Only you, signed in as the owner, can manage these subscriptions and read their delivery history.</p>
      {!data ? <Loading error={error} what="webhooks" /> : <>
        {error && <p className="error" role="alert">{error}</p>}
        {issued && <SecretPanel key={issued.secret} issued={issued} dismiss={() => setIssued(null)} />}
        <Table caption="Webhook subscriptions and data shared" heads={['Destination host', 'Events shared', 'Status', 'Actions']} empty="No webhook subscriptions yet.">
          {data.subscriptions.map(subscription => <tr key={subscription.id}>
            <td style={{ overflowWrap: 'anywhere' }}>{subscription.host}</td>
            <td>{subscription.events.join(', ')}</td>
            <td><Chip tone={subscription.enabled ? 'good' : 'neutral'}>{subscription.enabled ? 'Enabled' : 'Disabled'}</Chip></td>
            <td><div className="row-actions">
              <button type="button" className="btn btn-link" onClick={() => { setIssued(null); setEditing(subscription) }}>Edit webhook</button>
              <Action run={async () => done(await change('webhook.rotate', { id: subscription.id, revision: subscription.revision }))}>Rotate secret</Action>
              <Action run={async () => done(await change('webhook.set-enabled', { id: subscription.id, revision: subscription.revision, enabled: !subscription.enabled }))}>{subscription.enabled ? 'Disable webhook' : 'Enable webhook'}</Action>
              <Action tone="danger" run={async () => { setIssued(null); if (window.confirm(`Delete the webhook for ${subscription.host}? Pending deliveries will be cancelled.`)) await done(await change('webhook.delete', { id: subscription.id, revision: subscription.revision })) }}>Delete webhook</Action>
            </div></td>
          </tr>)}
        </Table>
        <h3>{editing ? `Edit webhook · ${editing.host}` : 'New webhook'}</h3>
        <SubscriptionForm key={`${editing?.id ?? 'new'}-${generation}`} subscription={editing} eventTypes={data.eventTypes} submit={body => change(editing ? 'webhook.edit' : 'webhook.create', { ...body, ...(editing ? { id: editing.id, revision: editing.revision } : {}) })} done={done} cancel={() => { setIssued(null); setEditing(null) }} />
        <details className="details"><summary>Data shared and receiver setup</summary>
          <p>Each host above receives its selected event types with only these payload fields: <code style={{ overflowWrap: 'anywhere' }}>{data.payloadFields.join(', ')}</code>. Personal fields, memos, amounts and documents are excluded. A separate scoped API credential is needed to read record details.</p>
          <p>Verify the HMAC-SHA256 signature over the timestamp, a period and the exact body bytes (<code>timestamp.body</code>). Refuse timestamps older than five minutes. Rotation keeps the previous and new signing secrets valid together for 24 hours.</p>
          <p>Deliveries may arrive more than once or out of order; use the event id to recognize repeats. Failed attempts retry after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, then stop. Disabling or deleting cancels pending attempts; enabling never resends them. Restored subscriptions are disabled, and enabling issues a new secret.</p>
        </details>
      </>}
    </Card>
    {data && <Card title="Webhook delivery history"><p>Destination hosts and delivery results are visible only to you. Request and response bodies and headers are never kept in this history.</p><DeliveryHistory history={data.history} /></Card>}
  </>
}
