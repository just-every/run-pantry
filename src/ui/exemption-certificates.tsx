// Shared certificate management for contacts and settings. Files go through the
// same authenticated document store as the rest of Pantry's source evidence.
import { useRef, useState } from 'react'
import { Action, Card, Chip, command, contactOptions, day, Field, FileLink, Form, Loading, readFileBase64, Table, useShared, useView, type D } from './kit'

export function ExemptionCitation({ invoice }: { invoice: D }) {
  const e = invoice.exemption
  return e ? <p className="hint">Exempt in {invoice.destination_state}: certificate {e.certificateNumber}, valid through {day(e.expiresOn)}. <FileLink id={e.documentId} name={e.documentName} /></p> : invoice.destination_state ? <p className="hint">Ship-to / destination state: {invoice.destination_state}</p> : null
}

export function ExemptionCertificates({ customerId }: { customerId?: string }) {
  const { state } = useShared(), { data, error, reload } = useView<D>('exemptions')
  const [renewing, setRenewing] = useState<D | null>(null), [adding, setAdding] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  if (!data) return <Loading what="exemption certificates" error={error} />
  const certificates = (data.certificates as D[]).filter(e => !customerId || e.customer_id === customerId)
  const due = certificates.filter(e => e.active && e.expires_on <= new Date(Date.parse(data.today + 'T00:00:00Z') + 30 * 86400000).toISOString().slice(0, 10))
  return <Card title="Customer exemption certificates" actions={state.actor.can.record && <button className="btn btn-secondary" type="button" onClick={() => { setRenewing(null); setAdding(true) }}>Add certificate</button>}>
    <p className="hint">Attach each customer's certificate and the states it covers. A valid certificate applies automatically only to invoices with a covered destination state. Renew it before expiry to keep exempt treatment.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {due.length > 0 && <div className="callout callout-warn" role="status"><strong>Certificates need renewal</strong>{due.map(e => <p key={e.id}>{e.customer_name}: certificate {e.certificate_number} {e.expires_on < data.today ? 'expired' : 'expires'} {day(e.expires_on)}. {e.email_status && <span>{e.email_status === 'development' ? 'Email is suppressed on this computer.' : e.email_status === 'in-app' ? 'Owner reminder shown here.' : e.email_status === 'failed' ? 'Owner email failed; the reminder remains here.' : `Owner reminder: ${e.email_status}.`}</span>}</p>)}</div>}
    <Table heads={['Customer', 'Certificate', 'Covered states', 'Expiry', 'Status', 'Document', 'Actions']} empty="No exemption certificates yet.">
      {certificates.map(e => <tr key={e.id}><td>{e.customer_name}</td><td>{e.certificate_number}</td><td>{e.states.join(', ')}</td><td>{day(e.expires_on)}</td><td><Chip tone={!e.active ? 'neutral' : e.expires_on < data.today ? 'warn' : 'good'}>{!e.active ? 'Retired' : e.expires_on < data.today ? 'Expired' : e.valid_from > data.today ? 'Not yet valid' : 'Valid'}</Chip></td><td><FileLink id={e.document_id} name={e.document_name} /></td><td>{!!e.active && state.actor.can.record && <><button className="btn btn-link" type="button" onClick={() => { setRenewing(e); setAdding(true) }}>Renew</button><Action run={async () => { await command('exemption.retire', { id: e.id, reason: 'Certificate withdrawn in certificate management' }); await reload() }}>Retire</Action></>}</td></tr>)}
    </Table>
    {adding && <Form key={renewing?.id ?? 'new'} label={renewing ? 'Save renewal' : 'Save certificate'} submit={async b => command('exemption.save', { ...b, customerId: customerId ?? renewing?.customer_id ?? b.customerId,
      replacesId: renewing?.id, states: String(b.states).split(/[\s,;]+/).filter(Boolean), ...(await readFileBase64(file.current)) })}
      onDone={async () => { setAdding(false); setRenewing(null); await reload() }} secondary={<button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>Cancel</button>}>
      {!customerId && !renewing && <Field label="Customer" name="customerId" required options={contactOptions(state.contacts, 'customer')} />}
      {renewing && <p>Renewing {renewing.certificate_number} for {renewing.customer_name}. The earlier certificate and issued invoices keep their original evidence.</p>}
      <Field label="Certificate number" name="certificateNumber" defaultValue={renewing?.certificate_number} required />
      <Field label="Covered states" name="states" defaultValue={renewing?.states.join(', ')} hint="Two-letter US state codes, separated by commas, for example NY, NJ" required />
      <Field label="Valid from" name="validFrom" type="date" defaultValue={data.today} required />
      <Field label="Expiry date" name="expiresOn" type="date" required />
      <label className="field">Certificate document<input ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" required /></label>
    </Form>}
  </Card>
}
