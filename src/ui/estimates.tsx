import { useState } from 'react'
import { Action, Card, Chip, command, Details, Loading, Metrics, Table, day, usd, useShared, useView, useWho, type D } from './kit'
import { EstimateDocumentPreview, EstimateEditor } from './estimate-editor'
import { EstimateProgress } from './estimate-progress'
import { DeliveryChip } from './invoice-delivery'

function EstimatePanel({ estimate: e, deposits, onEdit, onChange }: { estimate: D; deposits: D[]; onEdit: () => void; onChange: () => Promise<void> }) {
  const { state } = useShared(), who = useWho(), [reviewed, setReviewed] = useState(false)
  const held = deposits.filter(d => d.customer_id === e.customer_id).reduce((sum, d) => sum + d.remaining_cents, 0)
  return <div className="stack">
    <div className="split split-wide-left"><div className="stack">
    <Card title={`${e.customer_name} · ${e.number}`} actions={<Chip tone={e.status === 'accepted' ? 'good' : e.status === 'sent' ? 'info' : 'neutral'}>{e.status === 'accepted' ? 'Accepted' : e.status === 'sent' ? 'Sent' : 'Draft'}</Chip>}>

      <p>Estimate date {day(e.issue_date)} · Invoice terms to {day(e.due_date)}.</p>
      <Table heads={['Description', 'Quantity', 'Amount', 'Sales tax']} figures={[1, 2, 3]}>
        {e.lines.map((l: D, i: number) => <tr key={l.id ?? i}><td>{l.description}{l.kind === 'delivery' && <small className="sub block">Delivery charge</small>}</td><td className="fig">{l.quantity_milli / 1000}</td><td className="fig">{usd(l.amount_cents)}</td><td className="fig">{l.tax_code === 'exempt' ? 'Exempt' : l.tax_code ? usd(l.tax_cents) : 'Tax treatment needed'}</td></tr>)}
      </Table>
      {e.status !== 'accepted' && state.actor.can.record && <>
        <p className="hint">Review the saved document below before sending. Sending retains this exact revision and emails the customer's billing and CC contacts, or their primary email.</p>
        <label className="check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed this saved estimate revision and document.</label>
        <Action tone="primary" disabled={!reviewed} run={async () => { await command('estimate.send', { id: e.id, revision: e.revision }); setReviewed(false); await onChange() }}>{e.status === 'sent' ? 'Send estimate again' : 'Send estimate'}</Action>
      </>}

    </Card>
    <EstimateDocumentPreview key={e.id + e.revision + e.status} estimateId={e.id} revision={e.revision} />
    </div><Card title="Estimate summary">
      <dl className="summary"><div><dt>Estimate total</dt><dd>{usd(e.total_cents)}</dd></div><div><dt>Previously billed</dt><dd>{usd(e.billed_cents)}</dd></div><div><dt>Remaining to invoice</dt><dd>{usd(e.remaining_cents)}</dd></div></dl>
      <p><strong>Advance deposit held:</strong> {state.actor.role === 'sales' ? 'Financial access required' : usd(held)}</p>
      {e.acceptance && <div className="callout" role="status"><strong>Accepted by {e.acceptance.name}</strong><span><time dateTime={e.acceptance.at}>{new Date(e.acceptance.at).toLocaleString()}</time> · IP {e.acceptance.ip}</span><span style={{ overflowWrap: 'anywhere' }}>Accepted revision: {e.acceptance.revision}</span></div>}
      {e.public_path && <p><a href={e.public_path} target="_blank" rel="noreferrer">Open the customer's acceptance page</a></p>}
      <div className="row-actions">
        {e.status !== 'accepted' && state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={onEdit}>Edit estimate</button>}
        {e.public_path && state.actor.can.owner && <Action tone="danger" run={async () => { await command('estimate.link-revoke', { id: e.id, revision: e.revision }); await onChange() }}>Revoke acceptance link</Action>}
      </div>
      <Details facts={{ revision: e.revision, 'prepared by': who(e.prepared_by), sent: e.sent_at, 'PDF SHA-256': e.pdf_sha256 }} code={['revision', 'PDF SHA-256']} />
    </Card></div>
    <EstimateProgress key={e.id + e.revision + e.billed_cents} estimate={e} deposits={deposits} onDone={onChange} />
    <Card title="Estimate email history">
      <p className="hint">Provider acceptance does not confirm delivery or reading. Local messages are suppressed.</p>
      <Table heads={['When', 'Recipient', 'Outcome', 'Details']} empty="This estimate has not been emailed.">
        {e.deliveries.map((d: D) => <tr key={d.id}><td>{day(d.at)}</td><td>{d.recipient}</td><td><DeliveryChip status={d.status} /></td><td>{d.detail || '—'}</td></tr>)}
      </Table>
    </Card>
  </div>
}

export function Estimates({ onChange }: { onChange: () => Promise<void> }) {
  const { state } = useShared(), { data, error, reload } = useView<D>('estimates')
  const [selected, setSelected] = useState<string | null>(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('estimate'))
  const [editing, setEditing] = useState<D | null>(null)
  const { data: detail, error: detailError, reload: reloadDetail } = useView<D>(selected ? `estimates/${encodeURIComponent(selected)}` : null)
  const refresh = async () => { await Promise.all([reload(), reloadDetail(), onChange()]) }
  if (editing) return <EstimateEditor estimate={editing.id ? editing : undefined} onCancel={() => setEditing(null)} onDone={async saved => { setSelected(saved.id); setEditing(null); await refresh() }} />
  if (!data) return <Loading error={error} what="estimates" />
  const estimates = data.estimates as D[]
  if (selected) return <div className="stack">
    <div className="row-actions"><button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>Back to estimates</button><Action run={refresh}>Refresh estimate</Action></div>
    {detailError && detail && <p role="alert" className="error">{detailError}</p>}
    {detail ? <EstimatePanel key={detail.id + detail.revision} estimate={detail} deposits={data.deposits} onChange={refresh} onEdit={() => setEditing(detail)} /> : <Card title="Estimate"><Loading error={detailError} what="estimate details" /></Card>}
  </div>
  return <>
    {error && <p role="alert" className="error">{error}</p>}
    {detailError && detail && <p role="alert" className="error">{detailError}</p>}
    <Metrics items={['draft', 'sent', 'accepted'].map(status => { const rows = estimates.filter(e => e.status === status); return { label: status === 'draft' ? 'Draft estimates' : status === 'sent' ? 'Awaiting acceptance' : 'Accepted estimates', value: usd(rows.reduce((sum, e) => sum + e.total_cents, 0)), note: `${rows.length} estimate${rows.length === 1 ? '' : 's'}` } })} />
    <div className="stack">
      <Card title="Estimates" actions={state.actor.can.record && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>Create estimate</button>}>
        <Table heads={['Customer', 'Estimate', 'Date', 'Total', 'Previously billed', 'Remaining', 'Status']} figures={[3, 4, 5]} empty="No estimates yet. Add a customer, then create an estimate.">
          {estimates.map(e => <tr key={e.id} className={selected === e.id ? 'selected' : ''} tabIndex={0} onClick={() => setSelected(e.id)} onKeyDown={event => { if (event.key === 'Enter') setSelected(e.id) }}><td>{e.customer_name}</td><td><button type="button" className="btn btn-link" onClick={() => setSelected(e.id)}>{e.number}</button></td><td>{day(e.issue_date)}</td><td className="fig">{usd(e.total_cents)}</td><td className="fig">{usd(e.billed_cents)}</td><td className="fig">{usd(e.remaining_cents)}</td><td><Chip tone={e.status === 'accepted' ? 'good' : e.status === 'sent' ? 'info' : 'neutral'}>{e.status}</Chip></td></tr>)}
        </Table>
      </Card>

    </div>
  </>
}
