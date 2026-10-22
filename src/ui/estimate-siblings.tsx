import { useState } from 'react'
import { Action, Card, Chip, command, Details, Field, Form, Loading, Table, day, usd, useShared, useView, type D } from './kit'

type Provider = 'inkwell' | 'platter'
const providerName = (provider: Provider) => provider === 'inkwell' ? 'Inkwell' : 'Platter'
const sourceStyle = { overflowWrap: 'anywhere' as const }

const sourceErrors: Record<string, string> = {
  source_auth: 'The source refused this credential. Check its permissions or enter a replacement token.',
  source_missing: 'The selected source record was not found.', source_unavailable: 'The source could not be reached. Check the installation and request a new preview.',
  source_timeout: 'The source did not finish answering in time.', source_redirect: 'The source redirected the request. Enter its direct installation origin.',
  source_too_large: 'The source response exceeds the supported document size.', source_invalid: 'The source did not return a supported record.',
  source_not_completed: 'Complete the signature envelope in Inkwell before attaching it.', source_not_accepted: 'The proposal has not been accepted in Platter.',
  source_revision_mismatch: 'The source acceptance does not match its current proposal revision.', currency_mismatch: 'The proposal currency does not match these USD books.',
  amount_mismatch: 'The accepted proposal amount does not match this estimate.', contact_mismatch: 'The source signer or accepting contact does not match this customer.',
  original_mismatch: 'The signed envelope began with a different estimate PDF.', signed_mismatch: 'The downloaded signed document does not match Inkwell’s recorded hash.',
  origin_refused: 'The request left the selected installation origin.',
}
const sourceError = (code: string) => sourceErrors[code] ?? `The source request failed (${code}).`

function Source({ record }: { record: D }) {
  return <span style={sourceStyle}><a href={record.origin} target="_blank" rel="noreferrer">{record.origin}</a><small className="sub block">{record.remote_id} · Revision {record.remote_revision}</small></span>
}

function PreviewReview({ preview: p, estimate, onAttached }: { preview: D; estimate: D; onAttached: () => Promise<void> }) {
  const [reviewed, setReviewed] = useState(false)
  const s = p.summary, stale = p.estimate_revision !== estimate.revision, expired = Date.parse(p.expires_at) <= Date.now()
  return <Card title={`Review ${providerName(p.provider)} record`} actions={<Chip tone={stale || expired ? 'warn' : 'info'}>{stale ? 'Estimate changed' : expired ? 'Preview expired' : p.status === 'attached' ? 'Attached' : 'Awaiting review'}</Chip>}>
    <p><strong>{s.title}</strong> · {s.status}</p>
    <p style={sourceStyle}><Source record={p} /></p>
    <dl className="facts" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
      <div><dt>Matched customer</dt><dd>{estimate.customer_name}</dd></div>
      <div><dt>Contact in source</dt><dd>{s.contact_email}</dd></div>
      <div><dt>Estimate total</dt><dd>{usd(estimate.total_cents)}</dd></div>
      {p.provider === 'platter' && <><div><dt>Accepted proposal total</dt><dd>{usd(s.total_cents)} · {s.currency}</dd></div><div><dt>Requested proposal deposit</dt><dd>{usd(s.deposit_cents)} · not recorded as received</dd></div><div><dt>Accepted proposal revision</dt><dd>{p.remote_revision}</dd></div></>}
      {s.accepted_at && <div><dt>Accepted in source</dt><dd><time dateTime={s.accepted_at}>{new Date(s.accepted_at).toLocaleString()}</time></dd></div>}
      {s.completed_at && <div><dt>Completed in source</dt><dd><time dateTime={s.completed_at}>{new Date(s.completed_at).toLocaleString()}</time></dd></div>}
    </dl>
    {p.provider === 'inkwell' && <p className="callout"><strong>Original PDF matches this estimate.</strong><span>The signed document was downloaded from Inkwell and its hash verified. Document hashes and exact revisions are available in Details.</span></p>}
    <Details facts={{ 'estimate revision': p.estimate_revision, 'source revision': p.remote_revision, 'proof SHA-256': p.proof_sha256, 'source original PDF SHA-256': s.original_sha256, 'signed PDF SHA-256': s.signed_sha256, 'retained estimate PDF SHA-256': estimate.pdf_sha256, 'attached PDF SHA-256': p.pdf_sha256, 'preview expires': p.expires_at }} code={['estimate revision', 'source revision', 'proof SHA-256', 'source original PDF SHA-256', 'signed PDF SHA-256', 'retained estimate PDF SHA-256', 'attached PDF SHA-256']} />
    {stale || expired ? <p className="callout callout-warn">Request another preview of the source record against the current estimate before attaching it.</p> : p.status === 'pending' && <>
      <p className="hint">Attach the retained proof reviewed here. This records the external link; it does not accept the estimate, create an invoice, record a deposit or charge the customer.</p>
      <label className="check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed the customer, amounts, source revision and document hashes for this exact estimate revision.</label>
      <Action tone="primary" disabled={!reviewed} run={async () => { await command('estimate.sibling-confirm', { id: estimate.id, revision: estimate.revision, previewId: p.id, previewRevision: p.revision }); await onAttached() }}>Attach reviewed record</Action>
    </>}
  </Card>
}

function OwnerEstimateSiblings({ estimate, onChange }: { estimate: D; onChange: () => Promise<void> }) {
  const { data, error, reload } = useView<D>(`estimates/${encodeURIComponent(estimate.id)}/siblings`)
  const [provider, setProvider] = useState<Provider>('inkwell'), [token, setToken] = useState(''), [selected, setSelected] = useState<string | null>(null)
  const preview = data?.previews.find((p: D) => p.id === selected)
  const refresh = async () => { await Promise.all([reload(), onChange()]) }
  return <div className="stack">
    <Card title="Inkwell signatures and Platter proposals">
      <p>Download the retained estimate PDF to prepare and send an envelope in Inkwell. Select a completed envelope whose original document hash matches this estimate. For Platter, select an accepted proposal and review its exact revision, customer and amounts.</p>
      {estimate.pdf_sha256 && <p><a href={`/api/pantry/estimates/${encodeURIComponent(estimate.id)}/pdf`} target="_blank" rel="noreferrer">Download retained estimate PDF</a></p>}
      <p className="hint">Pantry contacts the source only when you request a preview below. Attaching a record does not send a document, change native acceptance, create accounting entries or charge the customer.</p>
      {estimate.pdf_sha256 ? <Form label="Preview external record" submit={async b => {
        const accessToken = token
        setToken('')
        const result = await command('estimate.sibling-preview', { id: estimate.id, revision: estimate.revision, provider, origin: b.origin, remoteId: b.remoteId, token: accessToken })
        await reload()
        if (!result.ok) throw new Error(sourceError(result.failure.error_class))
        return result
      }} onDone={result => { setSelected(result.preview.id) }}>
        <div className="grid-form">
          <Field label="Source app" name="provider" required value={provider} onChange={(event: any) => { setProvider(event.target.value); setToken('') }} options={[{ value: 'inkwell', label: 'Inkwell · completed signature envelope' }, { value: 'platter', label: 'Platter · accepted proposal' }]} />
          <Field label={`${providerName(provider)} installation origin`} name="origin" type="url" required placeholder="https://" hint="The HTTPS origin of your own installation." />
          <Field label={provider === 'inkwell' ? 'Completed envelope ID' : 'Accepted proposal ID'} name="remoteId" required />
          <Field label="Source access token" name="token" type="password" required value={token} onChange={(event: any) => setToken(event.target.value)} autoComplete="off" spellCheck={false} hint="Used for this preview request and cleared from this form when submitted. Never saved in Pantry." />
        </div>
      </Form> : <p className="hint">Send this estimate to retain its exact revision PDF before requesting an external record preview.</p>}
    </Card>
    {!data ? <Card title="External record history"><Loading error={error} what="external record history" /></Card> : <>
      {error && <p role="alert" className="error">{error}</p>}
      {preview && <PreviewReview key={preview.id + preview.revision + estimate.revision} preview={preview} estimate={estimate} onAttached={async () => { setSelected(null); await refresh() }} />}
      <Card title="Source previews" actions={<Action run={reload}>Refresh external record history</Action>}>
        <Table heads={['Source', 'Record', 'Status', 'Estimate revision', 'Review']} empty="No external records previewed.">
          {data.previews.map((p: D) => <tr key={p.id}><td>{providerName(p.provider)}</td><td><Source record={p} /></td><td><Chip>{p.status}</Chip></td><td style={sourceStyle}>{p.estimate_revision}</td><td><button type="button" className="btn btn-secondary" onClick={() => setSelected(p.id)}>Review source record</button></td></tr>)}
        </Table>
      </Card>
      <Card title="Attached signatures and proposals">
        <Table heads={['Source', 'Record', 'Attached', 'Retained proof']} empty="No external records attached.">
          {data.links.map((link: D) => <tr key={link.id}><td>{providerName(link.provider)}</td><td><Source record={link} /><small className="sub block">{link.summary.title} · {link.summary.status}</small></td><td>{day(link.attached_at)}</td><td>{link.document_href && <p><a href={link.document_href} target="_blank" rel="noreferrer">Open attached document</a></p>}<Details facts={{ 'estimate revision': link.estimate_revision, 'source revision': link.remote_revision, 'proof SHA-256': link.proof_sha256, 'PDF SHA-256': link.pdf_sha256 }} code={['estimate revision', 'source revision', 'proof SHA-256', 'PDF SHA-256']} /></td></tr>)}
        </Table>
      </Card>
      <Card title="Source request outcomes">
        <p className="hint">If a request failed, check the source and request a new preview using the form above.</p>
        <Table heads={['When', 'Source', 'Remote record', 'Reason']} empty="No source requests recorded.">
          {data.attempts.map((a: D) => <tr key={a.id}><td>{day(a.at)}</td><td>{providerName(a.provider)}<small className="sub block" style={sourceStyle}>{a.origin}</small></td><td style={sourceStyle}>{a.remote_id}</td><td>{sourceError(a.error_class)}</td></tr>)}
        </Table>
      </Card>
    </>}
  </div>
}

export function EstimateSiblings(props: { estimate: D; onChange: () => Promise<void> }) {
  const { state } = useShared()
  return state.actor.role === 'owner' ? <OwnerEstimateSiblings {...props} /> : null
}
