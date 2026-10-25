import { useState, type ChangeEvent } from 'react'
import { Action, Chip, Field, Loading, Table, command, day, usd, useView } from './kit'

type Kind = 'w9-request' | 'w9-reminder' | 'tax'
type Vendor = { id: string; name: string; email: string | null; optedOut: boolean }
type Item = { contactId?: string; name: string; to: string; subject: string; body: string; dueDate?: string; deadlineId?: string; amountCents?: number | null }
type Deadline = Pick<Item, 'name' | 'dueDate' | 'amountCents'> & { deadlineId: string; label: string }
type Outcome = { to: string; status: string; detail?: string }
type Batch = { id: string; kind: Kind; status: string; items: Item[]; outcomes: Outcome[]; created_at: string }
type Reminders = { vendors: Vendor[]; deadlines: Deadline[]; batches: Batch[]; enabled: boolean; mail: 'local' | 'ready' | 'none'; batchCap: number; dailyCap: number }
const kindLabels: Record<Kind, string> = { 'w9-request': 'W-9 request', 'w9-reminder': 'W-9 reminder', tax: 'Owner tax reminder' }

function BatchWording({ batch }: { batch: Batch }) {
  return <div className="stack">
    {batch.items.map((item, index) => <section key={`${item.to}-${index}`} aria-label={`Message to ${item.name}`}>
      <p style={{ overflowWrap: 'anywhere' }}><strong>{item.name}</strong><span className="sub block">To: {item.to}</span></p>
      {item.dueDate && <p>Recorded deadline: {day(item.dueDate)}{item.amountCents != null && <> · {usd(item.amountCents)} estimate</>}</p>}
      <p style={{ overflowWrap: 'anywhere' }}><strong>Subject:</strong> {item.subject}</p>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.body}</div>
    </section>)}
  </div>
}

function BatchReview({ batch, busy, disabled, send }: { batch: Batch; busy: boolean; disabled: boolean; send: () => Promise<void> }) {
  const [consent, setConsent] = useState(false), [attempted, setAttempted] = useState(false)
  return <section className="stack" aria-label="Review exact reminder batch">
    <h3>Review {batch.items.length} {batch.items.length === 1 ? 'message' : 'messages'}</h3>
    <p>Approve only the recipients and wording shown below. {batch.kind !== 'tax' && 'A secure, account-free W-9 link will be appended when each message is sent.'}</p>
    <BatchWording batch={batch} />
    <label className="check"><input type="checkbox" checked={consent} disabled={busy || attempted} onChange={event => setConsent(event.target.checked)} /> I approve sending this exact batch once to the recipients shown.</label>
    <Action tone="primary" disabled={busy || disabled || attempted || !consent || !batch.items.length} run={async () => { setAttempted(true); await send() }}>Approve and send {batch.items.length} {batch.items.length === 1 ? 'message' : 'messages'}</Action>
    {attempted && <p role="status">This approval was attempted. Check the recorded outcome below. Prepare a fresh batch for any further send.</p>}
  </section>
}

function BatchHistory({ batches }: { batches: Batch[] }) {
  return <details className="details">
    <summary>Batch history ({batches.length})</summary>
    <Table heads={['Prepared', 'Batch', 'Outcome', 'Review']} empty="No reminder batches prepared.">
      {batches.map(batch => <tr key={batch.id}>
        <td>{day(batch.created_at)}</td>
        <td>{kindLabels[batch.kind]}<span className="sub block">{batch.items.length} {batch.items.length === 1 ? 'message' : 'messages'}</span></td>
        <td><Chip>{batch.status}</Chip>{batch.outcomes.map((outcome, index) => <p key={index} style={{ overflowWrap: 'anywhere' }}>{outcome.to}: {outcome.status}{outcome.detail && <span className="sub block">{outcome.detail}</span>}</p>)}</td>
        <td><details className="details"><summary>Read exact messages</summary><BatchWording batch={batch} /></details></td>
      </tr>)}
    </Table>
  </details>
}

export function TaxReminders({ year }: { year: number }) {
  const { data, error, reload } = useView<Reminders>(`tax-reminders?year=${year}`)
  const [kind, setKind] = useState<Kind>('w9-request'), [selected, setSelected] = useState<string[]>([])
  const [selectedDeadlineIds, setSelectedDeadlineIds] = useState<string[]>([])
  const [batch, setBatch] = useState<Batch | null>(null), [busy, setBusy] = useState(false)
  const [preference, setPreference] = useState<boolean | null>(null), [preferenceError, setPreferenceError] = useState('')
  const change = async (work: () => Promise<void>) => { setBusy(true); try { await work() } finally { setBusy(false) } }
  return <details className="details">
    <summary>Reminder email and calendar</summary>
    {!data ? <Loading error={error} what="reminder controls" /> : <div className="stack">
      {error && <p className="error" role="alert">{error}</p>}
      <p>Each email batch needs your approval. Limits: {data.batchCap} messages per batch and {data.dailyCap} per day. Sends, opt-outs and calendar approvals are recorded in Activity.</p>
      {data.mail === 'local' && <p role="status">Local email is suppressed. Approval records a suppressed outcome; no email leaves this app.</p>}
      {data.mail === 'none' && <p role="status">Email delivery is not configured. You can review wording and download recorded deadlines.</p>}
      <label className="check"><input type="checkbox" checked={preference ?? data.enabled} disabled={busy} onChange={event => {
        const enabled = event.target.checked
        setPreference(enabled); setPreferenceError(''); setBatch(null)
        void change(async () => { await command('tax-reminders.preference', { enabled }); await reload(); setPreference(null) }).catch((err: Error) => setPreferenceError(`Not saved: ${err.message}`))
      }} /> Enable owner tax reminders and calendar</label>
      {preferenceError && <p className="error" role="alert">{preferenceError}</p>}
      <Field label="Message type" name="reminderKind" value={kind} disabled={busy} options={Object.entries(kindLabels).map(([value, label]) => ({ value, label }))} onChange={(event: ChangeEvent<HTMLSelectElement>) => { setKind(event.target.value as Kind); setBatch(null) }} />
      {kind === 'tax' ? <>
        <p>Choose active recorded deadlines to email to you as owner. Amounts are labelled estimates. These reminders do not pay or file taxes.</p>
        <Table heads={['Recorded deadline', 'Due', 'Estimated amount', 'Include']} empty="No active recorded deadlines.">
          {data.deadlines.map(deadline => <tr key={deadline.deadlineId}>
            <td>{deadline.label}</td>
            <td>{day(deadline.dueDate)}</td>
            <td>{deadline.amountCents == null ? 'Not set' : `${usd(deadline.amountCents)} · estimate`}</td>
            <td><label className="check"><input type="checkbox" checked={selectedDeadlineIds.includes(deadline.deadlineId)} disabled={busy || (!selectedDeadlineIds.includes(deadline.deadlineId) && selectedDeadlineIds.length >= data.batchCap)} onChange={event => {
              setSelectedDeadlineIds(current => event.target.checked ? [...current, deadline.deadlineId] : current.filter(id => id !== deadline.deadlineId)); setBatch(null)
            }} /> Include {deadline.label}</label></td>
          </tr>)}
        </Table>
        <p>{selectedDeadlineIds.length} of {data.batchCap} deadlines selected for this batch.</p>
      </> : <>
        <Table heads={['Vendor', 'Include', 'Email permission']} empty="No vendors available for a W-9 email.">
          {data.vendors.map(vendor => <tr key={vendor.id}>
            <td>{vendor.name}<span className="sub block" style={{ overflowWrap: 'anywhere' }}>{vendor.email || 'No email recorded'}</span></td>
            <td><label className="check"><input type="checkbox" checked={selected.includes(vendor.id)} disabled={busy || vendor.optedOut || !vendor.email || (!selected.includes(vendor.id) && selected.length >= data.batchCap)} onChange={event => {
              setSelected(current => event.target.checked ? [...current, vendor.id] : current.filter(id => id !== vendor.id)); setBatch(null)
            }} /> Include {vendor.name}</label></td>
            <td>{vendor.optedOut ? 'Stopped · opt-out retained' : <Action disabled={busy} run={() => change(async () => {
              setBatch(null); await command('tax-reminders.vendor-stop', { contactId: vendor.id }); setSelected(current => current.filter(id => id !== vendor.id)); await reload()
            })}>Stop email to {vendor.name}</Action>}</td>
          </tr>)}
        </Table>
        <p>{selected.length} selected. Vendor opt-outs stay in effect for future batches.</p>
      </>}
      <Action disabled={busy || (kind !== 'tax' && !selected.length) || (kind === 'tax' && (!data.enabled || !selectedDeadlineIds.length))} run={() => change(async () => {
        setBatch(null)
        const prepared = await command('tax-reminders.prepare', { kind, year, contactIds: kind === 'tax' ? [] : selected, deadlineIds: kind === 'tax' ? selectedDeadlineIds : [] })
        setBatch(prepared as Batch); await reload()
      })}>Prepare exact batch for review</Action>
      {batch && <BatchReview key={batch.id} batch={batch} busy={busy} disabled={data.mail === 'none' || (batch.kind === 'tax' && !data.enabled)} send={() => change(async () => {
        const sent = await command('tax-reminders.send', { id: batch.id, consent: true })
        setBatch(sent as Batch); await reload()
      })} />}
      <details className="details"><summary>Calendar download</summary>
        <p>Download the recorded deadlines for {year}. Calendar amounts are estimates. This records your approval and does not pay or file taxes.</p>
        <Action disabled={busy} run={() => change(async () => {
          const result = await command('tax-reminders.calendar', { year, consent: true })
          const url = URL.createObjectURL(new Blob([result.calendar], { type: ['text', 'calendar;charset=utf-8'].join('/') }))
          const anchor = document.createElement('a')
          anchor.href = url; anchor.download = result.filename; document.body.appendChild(anchor)
          try { anchor.click() } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
          await reload()
        })}>Approve calendar download (.ics)</Action>
      </details>
      <BatchHistory batches={data.batches} />
    </div>}
  </details>
}
