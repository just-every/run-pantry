import { Action, Card, Chip, Loading, useView, type D } from './kit'

export function DataFlows() {
  const {data,error,reload}=useView<D>('data-flows')
  if(!data)return <Loading error={error} what="service data flows" />
  return <div id="data-flows"><Card title="Data & connections" actions={<Action run={reload}>Refresh connections</Action>}>
    <p>Optional services receive data only after you set up their connection. Each authenticates with its own credential; no other service’s credentials are sent. Keys stay encrypted in this installation and are excluded from archives. Restore the books, then reconnect services with fresh credentials. Pantry charges no software or connection fee.</p>
    <p className="hint">Provider prices checked {data.pricesChecked}. Your provider’s plan, usage, taxes and agreement determine its bill. No Pantry Connect broker is available in this edition.</p>
    {data.services.map((s:D)=><details className="details" key={s.id} data-service={s.id}>
      <summary>{s.name} · {s.connected?'Connected':'Off'}</summary>
      <p><Chip tone={s.connected?'good':'info'}>{s.connected?'Connected':'Off'}</Chip> {s.detail}</p>
      {s.unavailable&&<p className="hint">{s.unavailable}</p>}
      <div className="stack"><p><strong>Sent</strong><br />{s.sends}</p><p><strong>Returned</strong><br />{s.receives}</p><p><strong>Path</strong><br />{s.path}</p><p><strong>Broker</strong><br />{s.broker}</p><p><strong>Fees · billed by {s.biller}</strong><br />{s.fees} <a href={s.pricing} target="_blank" rel="noreferrer">Provider prices</a>{s.id==='mail'&&<> · <a href="https://sendgrid.com/en-us/pricing" target="_blank" rel="noreferrer">SendGrid prices</a></>}</p><p><strong>Rotate or disconnect</strong><br />{s.controls}</p></div>
    </details>)}
    <details className="details"><summary>Services not available in this edition</summary><p>No data is sent to these services. Their connection pages must disclose the actual data, carrier and broker custody, prices and biller before they can be enabled.</p>{data.unavailable.map((s:D)=><div key={s.name}><strong>{s.name}</strong><p className="hint">{s.path} {s.fees} · {s.clause}</p></div>)}</details>
    <details className="details"><summary>Owner webhook destinations · {data.webhooks.length}</summary><p>Direct HTTPS; no Pantry Connect. No Pantry fee; the receiver’s hosting fees are its owner’s. The signing secret stays encrypted and is excluded from archives. Rotation and disconnection are in Webhooks.</p>{data.webhooks.map((s:D)=><div key={s.id}><strong>{s.host} · {s.enabled?'Enabled':'Disabled'}</strong><p>{s.events.join(', ')} · Fields: {s.payload.join(', ')}</p></div>)}</details>
    <details className="details"><summary>Owner API and agent access</summary><p>Direct requests to this installation; no Pantry Connect or automatic outbound send. API readers receive only their granted record types; agents read their context and prepare proposals for a person. No Pantry fee; the owner pays any client or agent provider it chooses. Revoke under API access or Agents; rotate by issuing a fresh credential and revoking the old one. Archives disable these credentials.</p>{data.integrations.map((i:D)=><p key={i.id}><strong>{i.name} · {i.active?'Active':'Revoked'}</strong> · {i.scopes.join(', ')}</p>)}{data.agents.map((a:D)=><p key={a.id}><strong>{a.name} · {a.active?'Active':'Disabled'}</strong> · proposal preparation</p>)}</details>
  </Card></div>
}
