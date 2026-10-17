// Receipts: take a photo or forward the email; Pantry reads the vendor, date
// and total, proposes the transaction, and attaches it when a person accepts.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Action, amountText, Card, Chip, command, day, Field, Form, Loading, PageHead, Table, usd, useShared, useView, useWho, type D } from './kit'
import { CaptureButtons } from './receipt-capture'
import { Icon } from './icons'

const IMAGE = /^image\/(png|jpeg|webp|gif)$/
/** A receipt's own amount: dollars, or the figure with its currency code. */
const money = (c: number, currency?: string | null) => currency && currency !== 'USD' ? `${amountText(c)} ${currency}` : usd(c)
const KIND: Record<string, string> = { bankline: 'Bank or card line', bill: 'Bill', payment: 'Payment', journal: 'Entry' }

function Preview({ r }: { r: D }) {
  const shownId = r.read_media_type && IMAGE.test(r.read_media_type) ? r.file_document_id : IMAGE.test(r.media_type) ? r.document_id : null
  return <div className="receipt-preview">
    {shownId ? <a href={`/api/pantry/documents/${shownId}?view=1`} target="_blank" rel="noreferrer"><img src={`/api/pantry/documents/${shownId}?view=1`} alt={`Receipt ${r.file_name}`} /></a>
      : <a className="receipt-file" href={`/api/pantry/documents/${r.document_id}`}><Icon name="receipt" /><span>{r.file_name}</span></a>}
    <small className="sub">{r.source === 'email' ? <>Emailed by {r.sender || 'unknown sender'}{r.subject ? <> · “{r.subject}”</> : null}</> : r.source === 'camera' ? 'Photo' : 'Uploaded'} · {day(r.received_at)}</small>
  </div>
}

function ReadLine({ r, reader }: { r: D; reader: D }) {
  if (r.read_status === 'read') return <p className="read-line"><Chip tone="info">Read by {r.read_model}</Chip>{r.read_note && <span className="hint"> {r.read_note}</span>}</p>
  if (r.read_status === 'no-key') return <p className="read-line"><Chip tone="warn">Not read</Chip> <span>Add a key to read receipts. {reader.canSet && <Link to="/app/settings" hash="ai-reading">Add a key</Link>}</span></p>
  return <p className="read-line"><Chip tone="warn">Not read</Chip> <span>{r.read_note}</span></p>
}

function ReceiptCard({ r, data, onChange }: { r: D; data: D; onChange: () => Promise<void> }) {
  const { state } = useShared()
  const [target, setTarget] = useState<string>(r.candidates[0] ? `${r.candidates[0].kind}:${r.candidates[0].id}` : '')
  const chosen = r.candidates.find((c: D) => `${c.kind}:${c.id}` === target)
  const canRead = !data.reader.unavailable && !data.reader.missing && r.read_status !== 'read'
  return <Card title={<><Icon name="receipt" /> {r.read_vendor ?? r.file_name}{r.read_total_cents ? <> · {money(r.read_total_cents, r.read_currency)}</> : null}</>} actions={<Chip tone="warn">To review</Chip>} className="receipt-card">
    <div className="receipt-body">
      <Preview r={r} />
      <div className="receipt-fields">
        <ReadLine r={r} reader={{ ...data.reader, canSet: state.actor.can.owner }} />
        {state.actor.can.record ? <Form label="Accept and attach" submit={b => command('receipt.attach', { ...b, id: r.id, revision: r.revision, targetKind: target.split(':')[0], targetId: target.split(':')[1] })} onDone={onChange} className="grid-form"
          secondary={<>{canRead && <Action run={async () => { await command('receipt.read', { id: r.id }); await onChange() }}>Read again</Action>}<Action run={async () => { await command('receipt.dismiss', { id: r.id, revision: r.revision }); await onChange() }}>Not a receipt</Action></>}>
          <Field label="Vendor" name="vendor" defaultValue={r.read_vendor ?? ''} />
          <Field label="Date" name="date" type="date" defaultValue={r.read_date ?? ''} />
          <Field label="Total" name="total" inputMode="decimal" defaultValue={r.read_total_cents ? amountText(r.read_total_cents) : ''} />
          <Field label="Tax" name="tax" inputMode="decimal" defaultValue={r.read_tax_cents !== null && r.read_tax_cents !== undefined ? amountText(r.read_tax_cents) : ''} />
          <Field label="Currency" name="currency" defaultValue={r.read_currency ?? ''} maxLength={3} />
          <Field label={chosen?.record ? 'Record to account' : 'Category'} name="accountId" defaultValue={r.read_account_id ?? ''} required={!!chosen?.record} options={data.accounts.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
          <fieldset className="checks field-wide match-choices"><legend>Attach to</legend>
            {r.candidates.length ? r.candidates.map((c: D, i: number) => <label key={c.id} className={target === `${c.kind}:${c.id}` ? 'chosen' : ''}>
              <input type="radio" name="target" value={`${c.kind}:${c.id}`} checked={target === `${c.kind}:${c.id}`} onChange={() => setTarget(`${c.kind}:${c.id}`)} required />
              <span><strong>{c.label}</strong> <span className="fig">{usd(c.amount_cents)}</span><small className="sub">{KIND[c.kind]} · {day(c.date)} · {c.detail}{i === 0 ? ' · best match' : ''}{c.record ? ' · accepting records it' : ''}</small></span>
            </label>) : <p className="hint">{r.read_total_cents ? 'No transaction with this total yet. It is offered here when the bank or card line, bill or payment arrives.' : 'Enter or read the total to find its transaction.'}</p>}
          </fieldset>
        </Form> : <p className="hint">A bookkeeper, accountant or the owner accepts receipts.</p>}
      </div>
    </div>
  </Card>
}

function Rules({ data, onChange }: { data: D; onChange: () => Promise<void> }) {
  return <Card title="Receipt rules">
    <p>Without a rule, nothing is attached or recorded until a person accepts it. A rule lets receipts from one vendor that match exactly one bank or card line (same total, within three days) attach and record themselves.</p>
    <Table heads={['Vendor', 'Records to', 'Up to', '']} figures={[2]} empty="No rules. Every receipt waits for a person.">
      {data.rules.map((x: D) => <tr key={x.id}><td>{x.vendor}</td><td>{x.code} · {x.account_name}</td><td className="fig">{usd(x.max_cents)}</td><td><Action tone="danger" run={async () => { await command('receipt-rule.remove', { id: x.id }); await onChange() }}>Remove</Action></td></tr>)}
    </Table>
    <Form label="Add rule" submit={b => command('receipt-rule.save', b)} onDone={onChange} className="grid-form">
      <Field label="Vendor name contains" name="vendor" required placeholder="Adobe" />
      <Field label="Record to" name="accountId" required options={data.accounts.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
      <Field label="Up to amount" name="max" required inputMode="decimal" placeholder="100.00" />
    </Form>
  </Card>
}

function Forwarding({ inbox, owner }: { inbox: D; owner: boolean }) {
  if (inbox.address) return <p className="forward-line"><Icon name="receipt" /> <span>Forward receipt emails to <code className="token">{inbox.address}</code>{inbox.lastReceivedAt && <small className="sub"> Last received {day(inbox.lastReceivedAt)}.</small>}</span></p>
  if (inbox.hosting === 'no-domain') return <p className="forward-line hint">Forwarding receipts by email needs a domain of your own; RER Managed hosting has none yet. Photos and uploads work here.</p>
  return <p className="forward-line hint">Forward receipts by email: {owner ? <Link to="/app/settings" hash="receipt-address">set up your Pantry address</Link> : 'the owner sets up a Pantry address'}.</p>
}

export function Receipts() {
  const { state, reload: reloadShared } = useShared(), who = useWho()
  const { data, error, reload } = useView<D>('receipts')
  const refresh = async () => { await reload(); await reloadShared() }
  return <>
    <PageHead title="Receipts" lead="Take a photo or forward the email. Pantry reads the vendor, date and total and proposes the transaction; nothing is attached or recorded until you accept." />
    {!data ? <Loading error={error} what="receipts" /> : <>
      <Card title="Add a receipt" className="card-stone">
        {state.actor.can.record ? <CaptureButtons onDone={refresh} /> : <p className="hint">Viewers see receipts; a bookkeeper, accountant or the owner adds them.</p>}
        {data.reader.unavailable ? <p className="hint">{data.reader.unavailable}</p> : data.reader.missing ? <p className="hint">{data.reader.missing} {state.actor.can.owner && <Link to="/app/settings" hash="ai-reading">Add a key</Link>}</p> : <p className="hint">Read with this install’s own AI model ({data.reader.model}). The original is kept exactly as received.</p>}
        <Forwarding inbox={data.inbox} owner={state.actor.can.owner} />
      </Card>
      {data.review.length ? data.review.map((r: D) => <ReceiptCard key={r.id + r.revision} r={r} data={data} onChange={refresh} />)
        : <Card title="To review" className="empty-card"><span className="empty-tile" aria-hidden="true" /><p>Nothing waiting. New receipts appear here with what was read and the transaction they belong to.</p></Card>}
      <Card title="Attached">
        <Table heads={['Date', 'Vendor', 'Total', 'Attached to', 'By', 'Receipt']} figures={[2]} empty="No receipts attached yet.">
          {data.attached.map((r: D) => <tr key={r.id}><td>{day(r.receipt_date ?? r.decided_at)}</td><td>{r.vendor ?? '—'}</td><td className="fig">{r.total_cents ? money(r.total_cents, r.currency) : '—'}</td>
            <td>{r.linked_kind && r.linked_id ? <Link to="/app/reports" search={{ record: `${r.linked_kind === 'journal' ? 'entry' : r.linked_kind}:${r.linked_id}` } as any}>{r.linked_label ?? 'Record'}</Link> : '—'}</td>
            <td>{r.rule_id ? <Chip tone="agent">Rule</Chip> : who(r.decided_by)}</td><td><a href={`/api/pantry/documents/${r.document_id}`}>{r.file_name}</a></td></tr>)}
        </Table>
      </Card>
      {state.actor.can.owner && <Rules data={data} onChange={reload} />}
    </>}
  </>
}
