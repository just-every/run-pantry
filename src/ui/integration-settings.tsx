import { useState } from 'react'
import { Action, Card, Chip, command, day, Field, Form, Loading, Table, useShared, useView, usd, type D } from './kit'

type Scope = { id: string; label: string; help: string }
type Credential = { id: string; name: string; scopes: string[]; created_at: string; created_by: string; revoked_at: string | null }
type CreatedCredential = { id: string; name: string; token: string; scopes: string[] }
type IntegrationCall = { id: string; credential_id: string; name: string; at: string; method: string; path: string; status: number }
type Integrations = { connections: D[]; credentials: Credential[]; calls: IntegrationCall[]; scopes: Scope[]; nextCursor: string | null }

function NewCredential({ scopes, onCreated }: { scopes: Scope[]; onCreated: (credential: CreatedCredential) => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([])
  return <Form label="Create integration credential" className="grid-form" submit={b => {
    if (!selected.length) throw new Error('Choose at least one scope for this credential.')
    return command('integration.create', { name: String(b.name).trim(), scopes: selected })
  }} onDone={onCreated}>
    <Field label="Integration name" name="name" required hint="For example, Pier, Cabin or Coffer. Use a separate credential for each connection." />
    <p className="hint field-wide">Choose each record type separately. Read grants allow business records without writing or posting. Saved report and management package definition grants delegate access to all definitions of that type, separately from sharing with people. Security settings, credentials and webhook history remain owner-only.</p>
    <fieldset className="checks field-wide"><legend>Allowed scopes</legend>
      {scopes.map(scope => <label key={scope.id}>
        <input type="checkbox" name={scope.id} checked={selected.includes(scope.id)} onChange={e => setSelected(current => e.target.checked ? [...current, scope.id] : current.filter(id => id !== scope.id))} />
        <span>{scope.label} <code>{scope.id}</code><small className="hint" style={{ display: 'block' }}>{scope.help}</small></span>
      </label>)}
    </fieldset>
    <p className="hint field-wide">The <strong>post</strong> scope lets a sibling book post its approved records in Pantry. Without it, bills, invoices and journals stay drafts for a person to review. Recording money already received or paid needs both <strong>payments:write</strong> and <strong>post</strong>; it does not move money. Vendor credits and their allocations also need both <strong>vendor-credits:write</strong> and <strong>post</strong>; credits post immediately and have no draft state.</p>
  </Form>
}

function CredentialToken({ credential, onDismiss }: { credential: CreatedCredential; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return <div className="callout callout-warn" role="status">
    <strong>Copy {credential.name}'s credential now — it is shown once.</strong>
    <code className="token" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{credential.token}</code>
    <span>Keep it in the sibling book's private configuration. Pantry cannot show it again after you dismiss it or leave this page.</span>
    <div className="row-actions">
      <Action run={async () => { await navigator.clipboard.writeText(credential.token); setCopied(true) }}>{copied ? 'Copied' : 'Copy credential'}</Action>
      <button type="button" className="btn btn-secondary" onClick={onDismiss}>I saved it</button>
    </div>
  </div>
}

function Credentials({ credentials, scopes, revoke }: { credentials: Credential[]; scopes: Scope[]; revoke: (id: string) => Promise<void> }) {
  const labels = new Map(scopes.map(scope => [scope.id, scope.label]))
  return <Table heads={['Integration', 'Scopes', 'Created', 'Status', '']} caption="Integration credentials" empty="No integration credentials yet.">
    {credentials.map(credential => <tr key={credential.id}>
      <td style={{ overflowWrap: 'anywhere' }}>{credential.name}</td>
      <td>{credential.scopes.map(scope => <small className="sub block" key={scope}>{labels.get(scope) ?? scope}</small>)}</td>
      <td>{day(credential.created_at)}<small className="sub block">by {credential.created_by}</small></td>
      <td>{credential.revoked_at ? <><Chip>Revoked</Chip><small className="sub block">{day(credential.revoked_at)}</small></> : <Chip tone="good">Active</Chip>}</td>
      <td>{!credential.revoked_at && <Action tone="danger" run={() => revoke(credential.id)}>Revoke</Action>}</td>
    </tr>)}
  </Table>
}

function RecentCalls({ calls, nextCursor, older, latest, paged }: { calls: IntegrationCall[]; nextCursor: string | null; older: () => void; latest: () => void; paged: boolean }) {
  return <>
    <h3>Recent API calls</h3>
    <Table heads={['Time', 'Credential', 'Request', 'Status']} caption="Recent integration API calls" empty="No integration API calls yet.">
      {calls.map(call => <tr key={call.id}>
        <td><time dateTime={call.at}>{new Date(call.at).toLocaleString()}</time></td>
        <td style={{ overflowWrap: 'anywhere' }}>{call.name}</td>
        <td><code style={{ overflowWrap: 'anywhere' }}>{call.method} {call.path}</code></td>
        <td><Chip tone={call.status >= 400 ? 'bad' : call.status >= 300 ? 'warn' : 'good'}>{call.status}</Chip></td>
      </tr>)}
    </Table>
    <nav className="row-actions" aria-label="Integration call pages">
      {paged && <button type="button" className="btn btn-secondary" onClick={latest}>Latest calls</button>}
      {nextCursor && <button type="button" className="btn btn-secondary" onClick={older}>Older calls</button>}
    </nav>
  </>
}

export function IntegrationSettings() {
  const owner = useShared().state.actor.can.owner
  const [cursor, setCursor] = useState<string | null>(null)
  const path = 'integrations' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')
  const { data, error, reload } = useView<Integrations>(owner ? path : null)
  const [token, setToken] = useState<CreatedCredential | null>(null)
  if (!owner) return null
  const refreshLatest = async () => {
    if (cursor) setCursor(null)
    else await reload()
  }
  const visibleToken = token && !data?.credentials.some(credential => credential.id === token.id && credential.revoked_at) ? token : null
  const revoke = async (id: string) => {
    await command('integration.revoke', { id })
    setToken(current => current?.id === id ? null : current)
    await refreshLatest()
  }
  return <Card title="Integration credentials" actions={<Action run={refreshLatest}>Refresh integrations</Action>}>
    <p>Give a sibling book such as Pier, Cabin or Coffer a credential scoped to the work it needs. This credential cannot sign in as a person. It keeps working after you sign out or your session expires, and stays active until you revoke it.</p>
    <details className="setup-steps"><summary>Set up a sibling book integration</summary>
      <ol className="how-to">
        <li>Name the connection and choose only the scopes that book needs.</li>
        <li>Create the credential, copy it once and keep it in that book's private integration configuration. Anyone holding it can use its allowed scopes.</li>
        <li>Revoke the credential here when the connection should stop. To replace a lost credential, revoke it and create another.</li>
      </ol>
      <p className="hint"><a href="https://run-pantry.com/docs/integrations" target="_blank" rel="noreferrer">Integration setup and API documentation</a></p>
    </details>
    {!data ? <Loading error={error} what="integration credentials" /> : <>
      {error && <p className="error" role="alert">{error}</p>}
      {visibleToken && <CredentialToken key={visibleToken.id} credential={visibleToken} onDismiss={() => setToken(null)} />}
      <h3>Connections</h3>
      <Table heads={['Connection', 'Status and reason', 'Last sync', 'Objects synced', 'Provider and ledger', '']} caption="Connection health">
        {data.connections.map(c => <tr key={c.id}>
          <td>{c.name}</td><td><Chip tone={c.status === 'Needs attention' ? 'bad' : 'info'}>{c.status}</Chip><small className="sub block">{c.reason}</small></td>
          <td>{c.lastSync ? new Date(c.lastSync).toLocaleString() : 'Not measured'}</td><td>{c.objects ?? 'Not measured'}</td>
          <td>{c.tieOut ? <>{c.tieOut.label}<small className="sub block">{c.tieOut.complete ? 'Complete read' : 'Incomplete read'}</small><small className="sub block">Provider: {c.tieOut.providerCents === null ? 'Not measured' : usd(c.tieOut.providerCents)} · Ledger: {usd(c.tieOut.ledgerCents)} · Difference: {c.tieOut.differenceCents === null ? 'Not measured' : usd(c.tieOut.differenceCents)}</small></> : 'Not measured'}</td>
          <td>{c.retry && <Action run={async () => { await command(c.retry, {}); await refreshLatest() }}>Retry {c.name}</Action>}</td>
        </tr>)}
      </Table>
      <Credentials credentials={data.credentials} scopes={data.scopes} revoke={revoke} />
      {!visibleToken && <NewCredential scopes={data.scopes} onCreated={async credential => { setToken(credential); await refreshLatest() }} />}
      <RecentCalls calls={data.calls} nextCursor={data.nextCursor} paged={cursor !== null} older={() => setCursor(data.nextCursor)} latest={() => setCursor(null)} />
    </>}
  </Card>
}
