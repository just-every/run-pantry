import { ReceiptCash } from './receipt-cash'
import { CaptureApprovalRules } from './capture-approval-rules'
import { ReceiptDraft } from './receipt-draft'
import { ReceiptVendor } from './receipt-vendor'
// Receipts: take a photo or forward the email; Pantry reads the vendor, date
// and total, proposes the transaction, and attaches it when a person accepts.
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Action, amountText, api, Card, Chip, command, day, Field, FileLink, Form, IMAGE_TYPE as IMAGE, Loading, PageHead, Table, usd, useShared, useView, useWho, type D } from './kit'
import { CaptureButtons } from './receipt-capture'
import { Icon } from './icons'

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

type Typed = { vendor: string; invoiceNumber: string; date: string; total: string; currency: string; tip: string; chargedUsd: string; cardLast4: string }
const NONE: D[] = []

/** The transactions this receipt may belong to: those found from what was read, then, once a person
 * types or corrects the vendor, date, total or currency, those found from what they typed. */
function useMatches(r: D) {
  const [typed, setTyped] = useState<Typed | null>(null), [found, setFound] = useState<D[] | null>(null), [error, setError] = useState(''), [duplicate, setDuplicate] = useState<D | null>(r.duplicate), [basis, setBasis] = useState(r.duplicate_basis)
  useEffect(() => {
    if (!typed) return
    let live = true
    const timer = setTimeout(async () => {
      try { const v = await api('receipts/candidates?' + new URLSearchParams({ ...typed, id: r.id })); if (live) { setFound(v.candidates); setDuplicate(v.duplicate); setBasis(v.duplicateBasis); setError('') } }
      catch (e) { if (live) { setFound([]); setError((e as Error).message) } }
    }, 300)
    return () => { live = false; clearTimeout(timer) }
  }, [typed?.vendor, typed?.invoiceNumber, typed?.date, typed?.total, typed?.currency, typed?.tip, typed?.chargedUsd, typed?.cardLast4])
  const match = r.read_match_fields ? JSON.parse(r.read_match_fields) : {}
  const initial: Typed = { tip: match.tip ? amountText(match.tip) : '', chargedUsd: match.chargedUsd ? amountText(match.chargedUsd) : '', cardLast4: match.cardLast4 ?? '', vendor: r.vendor ?? r.read_vendor ?? '', invoiceNumber: r.invoice_number ?? r.read_invoice_number ?? '', date: r.receipt_date ?? r.read_date ?? '', total: (r.total_cents ?? r.read_total_cents) ? amountText(r.total_cents ?? r.read_total_cents) : '', currency: r.currency ?? r.read_currency ?? '' }
  const type = (field: keyof Typed) => (e: any) => { const value = e.target.value; setTyped(t => ({ ...(t ?? initial), [field]: value })) }
  const total = typed ? typed.total : initial.total
  return { fields: typed ?? initial, duplicate, basis, list: (typed ? found : r.candidates) ?? NONE, looking: !!typed && found === null && /\d/.test(total), total, error, type }
}

function ReceiptCard({ r, data, onChange }: { r: D; data: D; onChange: () => Promise<void> }) {
  const { state } = useShared(), m = useMatches(r)
  const [target, setTarget] = useState<string>(r.candidates[0] ? `${r.candidates[0].kind}:${r.candidates[0].id}` : '')
  // A new list keeps the person's choice when it is still offered, else offers its best match.
  useEffect(() => { if (!m.list.some((c: D) => `${c.kind}:${c.id}` === target)) setTarget(m.list[0] ? `${m.list[0].kind}:${m.list[0].id}` : '') }, [m.list])
  const chosen = m.list.find((c: D) => `${c.kind}:${c.id}` === target)
  const canRead = !data.reader.unavailable && !data.reader.missing && r.read_status !== 'read'
  const accept = (b: D) => {
    if (!chosen) throw new Error(m.total ? 'Choose the transaction this receipt belongs to. None has this total yet: import the bank or card statement, or record the bill or payment, then come back.' : 'Enter the total to find the transaction this receipt belongs to.')
    return command('receipt.attach', { ...b, id: r.id, revision: r.revision, targetKind: chosen.kind, targetId: chosen.id }).catch(async e => { await onChange(); throw e })
  }
  return <Card title={<><Icon name="receipt" /> {r.read_vendor ?? r.file_name}{r.read_total_cents ? <> · {money(r.read_total_cents, r.read_currency)}</> : null}</>} actions={<Chip tone="warn">{m.duplicate ? 'Duplicate' : 'To review'}</Chip>} className="receipt-card">
    <div className="receipt-body">
      <Preview r={r} />
      <div className="receipt-fields">
        {m.duplicate && <p className="hint" role="status">Duplicate receipt · {m.basis === 'file' ? 'same file' : m.basis === 'vendor-invoice' ? 'same vendor and invoice number' : 'same vendor, date and total'}. Original: <FileLink id={m.duplicate.document_id} name={m.duplicate.file_name} mediaType={m.duplicate.media_type} />{m.duplicate.status === 'attached' ? <> · already attached {day(m.duplicate.decided_at)}</> : ' · waiting for review'}. Choose Keep both with a reason, or Skip.</p>}
        <ReadLine r={r} reader={{ ...data.reader, canSet: state.actor.can.owner }} />
        {r.read_status !== 'read' && state.actor.can.record && <p className="hint">Type the vendor, date and total from the receipt: the transactions with that total are listed under <strong>Attach to</strong>.</p>}
        {state.actor.can.record && <ReceiptVendor r={r} accounts={data.accounts} vendors={state.contacts.filter((v: D) => v.kind === 'vendor')} onChange={onChange} />}
        {state.actor.can.record && <ReceiptCash r={r} onChange={onChange} />}
        {state.actor.can.record && <ReceiptDraft r={r} accounts={data.accounts} onChange={onChange} />}
        {!r.draftProposal?.saved && (state.actor.can.record ? <Form label={m.duplicate ? "Keep both" : "Accept and attach"} submit={async b => accept(b)} onDone={onChange} className="grid-form"
          secondary={<>{canRead && <Action run={async () => { await command('receipt.read', { id: r.id }); await onChange() }}>Read again</Action>}<Action run={async () => { await command('receipt.dismiss', { id: r.id, revision: r.revision, ...m.fields, reason: m.duplicate ? 'Duplicate skipped' : '' }); await onChange() }}>{m.duplicate ? 'Skip' : 'Not a receipt'}</Action></>}>
          {m.duplicate && <Field label="Reason to keep both" name="duplicateReason" required maxLength={300} wide />}
          <Field label="Vendor" name="vendor" defaultValue={r.vendor ?? r.read_vendor ?? ''} onChange={m.type('vendor')} />
          <Field label="Invoice number" name="invoiceNumber" defaultValue={r.invoice_number ?? r.read_invoice_number ?? ''} maxLength={80} onChange={m.type('invoiceNumber')} />
          <Field label="Date" name="date" type="date" defaultValue={r.receipt_date ?? r.read_date ?? ''} onChange={m.type('date')} />
          <Field label="Total" name="total" inputMode="decimal" defaultValue={(r.total_cents ?? r.read_total_cents) ? amountText(r.total_cents ?? r.read_total_cents) : ''} onChange={m.type('total')} />
          <Field label="Tax" name="tax" inputMode="decimal" defaultValue={(r.tax_cents ?? r.read_tax_cents) !== null && (r.tax_cents ?? r.read_tax_cents) !== undefined ? amountText(r.tax_cents ?? r.read_tax_cents) : ''} />
          <Field label="Currency" name="currency" defaultValue={r.currency ?? r.read_currency ?? ''} maxLength={3} onChange={m.type('currency')} />
          <Field label="Printed tip" name="tip" inputMode="decimal" defaultValue={m.fields.tip} onChange={m.type('tip')} hint="Allows this much difference from the receipt total" />
          <Field label="USD charge on receipt or card evidence" name="chargedUsd" inputMode="decimal" defaultValue={m.fields.chargedUsd} onChange={m.type('chargedUsd')} hint="Required for foreign currency; never an estimated exchange rate" />
          <Field label="Card last four" name="cardLast4" maxLength={4} defaultValue={m.fields.cardLast4} onChange={m.type('cardLast4')} />
          <Field label={chosen?.record ? 'Record to account' : 'Category'} name="accountId" defaultValue={r.account_id ?? r.read_account_id ?? ''} required={!!chosen?.record} options={data.accounts.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
          <fieldset className="checks field-wide match-choices" aria-busy={m.looking}><legend>Attach to</legend>
            {m.list.length ? m.list.map((c: D, i: number) => <label key={c.id} className={target === `${c.kind}:${c.id}` ? 'chosen' : ''}>
              <input type="radio" name="target" value={`${c.kind}:${c.id}`} checked={target === `${c.kind}:${c.id}`} onChange={() => setTarget(`${c.kind}:${c.id}`)} required />
              <span><strong>{c.label}</strong> <span className="fig">{usd(c.amount_cents)}</span><small className="sub">{KIND[c.kind]} · {day(c.date)} · {c.detail}{i === 0 ? ' · best match' : ''}{c.record ? ' · accepting records it' : ''}</small></span>
            </label>) : <p className="hint">{m.looking ? 'Finding transactions with this total…' : m.total ? 'No transaction with this total yet. It is offered here when the bank or card line, bill or payment arrives.' : 'Enter the total to find its transaction.'}</p>}
            {m.error && <p role="alert" className="error">{m.error}</p>}
          </fieldset>
        </Form> : <p className="hint">A bookkeeper, accountant or the owner accepts receipts.</p>)}
      </div>
    </div>
  </Card>
}

function Rules({ data, onChange }: { data: D; onChange: () => Promise<void> }) {
  return <Card title="Receipt rules">
    <p>Without a rule, nothing is attached or recorded until a person accepts it. A rule lets receipts from one vendor that match exactly one bank or card line (same USD total, within five days, matching vendor or card last four) attach and record themselves.</p>
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
      <Card title="Add a receipt">
        {state.actor.can.record ? <CaptureButtons key={data.review.map((r: D) => r.id).join(':')} onDone={refresh} /> : <p className="hint">Viewers see receipts; a bookkeeper, accountant or the owner adds them.</p>}
        {data.reader.unavailable ? <p className="hint">{data.reader.unavailable}</p> : data.reader.missing ? <p className="hint">{data.reader.missing} {state.actor.can.owner && <Link to="/app/settings" hash="ai-reading">Add a key</Link>}</p> : <p className="hint">Read with this install’s own AI model ({data.reader.model}). The original is kept exactly as received.</p>}
        <Forwarding inbox={data.inbox} owner={state.actor.can.owner} />
      </Card>
      <CaptureApprovalRules rules={data.approvalRules} accounts={data.accounts} onChange={refresh} />
      {data.review.length ? data.review.map((r: D) => <div id={`receipt-${r.id}`} key={r.id + r.revision}><ReceiptCard r={r} data={data} onChange={refresh} /></div>)
        : <Card title="To review" className="empty-card"><span className="empty-lines" aria-hidden="true" /><p>Nothing waiting. New receipts appear here with what was read and the transaction they belong to.</p></Card>}
      {data.duplicateDocuments?.map((d: D) => <div key={d.id} id={`document-${d.id}`}><Card title="Duplicate document" actions={<Chip tone="warn">Duplicate</Chip>}>
        <p><FileLink id={d.id} name={d.name} mediaType={d.media_type} /> · {d.duplicate_basis === 'file' ? 'same file' : d.duplicate_basis === 'vendor-invoice' ? 'same vendor and invoice number' : 'same vendor, date and total'}. Original: <FileLink id={d.duplicate.document_id} name={d.duplicate.file_name} mediaType={d.duplicate.media_type} /></p>
        {state.actor.can.record && <Form label="Keep both" submit={b => command('document.duplicate-decide', { id: d.id, decision: 'keep', reason: b.reason })} onDone={refresh} className="grid-form"
          secondary={<Action run={async () => { await command('document.duplicate-decide', { id: d.id, decision: 'skip', reason: 'Duplicate skipped' }); await refresh() }}>Skip</Action>}>
          <Field label="Reason to keep both" name="reason" required maxLength={300} wide />
        </Form>}
      </Card></div>)}
      <Card title="Attached">
        <Table heads={['Date', 'Vendor', 'Total', 'Attached to', 'By', 'Receipt']} figures={[2]} empty="No receipts attached yet.">
          {data.attached.map((r: D) => <tr key={r.id} id={`receipt-${r.id}`}><td>{day(r.receipt_date ?? r.decided_at)}</td><td>{r.vendor ?? '—'}{r.duplicate_reason && <small className="sub"> · Kept both · {r.duplicate_reason}</small>}</td><td className="fig">{r.total_cents ? money(r.total_cents, r.currency) : '—'}</td>
            <td>{r.linked_kind && r.linked_id ? <Link to="/app/reports" search={{ record: `${r.linked_kind === 'journal' ? 'entry' : r.linked_kind}:${r.linked_id}` } as any}>{r.linked_label ?? 'Record'}</Link> : '—'}</td>
            <td>{r.rule_id ? <Chip tone="agent">Rule</Chip> : who(r.decided_by)}</td><td><FileLink id={r.document_id} name={r.file_name} mediaType={r.media_type} /></td></tr>)}
        </Table>
      </Card>
      {data.skipped?.length > 0 && <Card title="Skipped duplicates">
        <Table heads={['Skipped', 'Copy', 'Original']}>
          {data.skipped.map((r: D) => <tr key={r.id}><td>{day(r.decided_at)}</td><td>{r.source === 'email' ? 'Emailed copy skipped' : 'Copy skipped'} · {r.file_name}</td><td><FileLink id={r.original_document_id} name={r.original_file_name} mediaType={r.original_media_type} />{r.original_attached_at && <small className="sub">Already attached {day(r.original_attached_at)}</small>}</td></tr>)}
        </Table>
      </Card>}
      {state.actor.can.owner && <Rules data={data} onChange={reload} />}
    </>}
  </>
}
