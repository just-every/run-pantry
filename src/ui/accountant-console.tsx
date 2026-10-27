import { useEffect, useState } from 'react'
import { Action, Card, command, Field, Form, Table, useShared, useView, type D } from './kit'

export function AccountantConsole() {
  const { state } = useShared(), { data, error, reload } = useView('accountant-console')
  useEffect(() => {
    const timer = window.setInterval(() => { void reload() }, 30000)
    const focus = () => { void reload() }
    window.addEventListener('focus', focus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [reload])
  return <Card title="Accountant console" actions={<Action run={reload}>Refresh client status</Action>}>
    <p>Client owners share status for one day. Opening books uses that client's own sign-in and current grants.</p>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <Table heads={['Client', 'Books up to date through', 'Review queue', 'Open questions', 'Close status', 'Grants', '']} empty="No clients connected yet.">
        {data.clients.map((client: D) => <tr key={client.origin}><td>{client.name}</td><td>{client.currentThrough ?? 'Not yet established'}</td><td>{client.reviewQueue ?? 'Restricted'}</td><td>{client.openQuestions ?? 'Restricted'}</td><td>{client.closeStatus ?? 'Restricted'}</td><td>{Object.entries(client.grants).filter(([,value]) => value).map(([name]) => name).join(', ') || 'Read and prepare'}</td><td><a className="btn btn-link" href={client.origin + '/app'} target="_blank" rel="noreferrer">Open books</a> <Action run={async () => { await command('accountant.client-remove', {origin:client.origin}); await reload() }}>Disconnect</Action></td></tr>)}
      </Table>
      {data.unavailable.length > 0 && <p role="status">Status unavailable: {data.unavailable.join(', ')}. Refresh after checking the connection.</p>}
      <details><summary>Connect a client</summary>
        <Form label="Connect client" submit={b => command('accountant.client-save', b)} onDone={reload}>
          <Field label="Trusted client origin" name="origin" required options={data.trustedOrigins.map((origin: string) => ({value:origin,label:origin}))} />
          <Field label="Client status key" name="token" type="password" required autoComplete="off" />
        </Form>
      </details>
    </>}
    {state.actor.can.owner && <ShareStatus />}
  </Card>
}

function ShareStatus() {
  const { state } = useShared()
  return <StatusShareForm members={state.settings.members.filter((member: D) => member.active && member.role === 'accountant')} />
}

function StatusShareForm({ members }: {members:D[]}) {
  const [shared, setShared] = useState<D>(), [visible, setVisible] = useState(false)
  return <details><summary>Share this client's status</summary>
    <p>Only the named accountant receives status. Replacing the key, changing their membership or revoking sharing disables the old key. Status keys cannot open books or change entries.</p>
    <Form label="Share client status" submit={b => command('accountant.status-share', {...b,consent:'SHARE STATUS'})} onDone={setShared}>
      <Field label="Accountant" name="email" required options={members.map(member => ({value:member.email,label:member.name}))} />
    </Form>
    {shared && <div role="status"><p>Give this one-day status key to the accountant. It is shown once.</p><input aria-label="New client status key" type={visible ? 'text' : 'password'} readOnly value={shared.token} autoComplete="off" /><button type="button" className="btn btn-secondary" onClick={() => setVisible(value => !value)}>{visible ? 'Hide key' : 'Show key'}</button></div>}
    {members.map(member => <p key={member.email}>{member.name} <Action run={async () => { await command('accountant.status-revoke',{email:member.email});setShared(undefined) }}>Revoke status sharing</Action></p>)}
  </details>
}
