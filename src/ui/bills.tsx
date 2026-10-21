import { useRef, useState } from 'react'
import { Action, Card, Chip, command, contactOptions, Field, Form, Table, accountOptions, day, readFileBase64, today, usd, useShared, type D } from './kit'
import { CaptureApprovalRules } from './capture-approval-rules'
import { BillWorkflow, CapturedBills, RecurringBills } from './bill-workflow'
import { VendorHistory } from './vendor-history'

function BillForm({ bill, onDone, onCancel }: { bill?: D; onDone: () => Promise<void>; onCancel?: () => void }) {
  const { state } = useShared(), [lines, setLines] = useState<D[]>(bill ? bill.lines.map((l: D) => ({ description: l.description, accountId: l.account_id, amount: (l.amount_cents / 100).toFixed(2) })) : [{ description: '', accountId: '', amount: '' }])
  const set = (i: number, patch: D) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  const expense = accountOptions(state.accounts, a => !['bank', 'receivable', 'payable'].includes(a.subtype) && (a.type === 'expense' || a.type === 'asset'))
  return <Form label={bill ? "Save bill revision" : "Save bill"} submit={b => command(bill ? 'bill.update' : 'bill.save', { ...b, ...(bill ? { id: bill.id, revision: bill.revision } : {}), post: b.post === 'on', lines })} onDone={async () => { setLines([{ description: '', accountId: '', amount: '' }]); await onDone() }}>
    <div className="grid-form">
      <Field label="Vendor" name="vendorId" defaultValue={bill?.vendor_id} required options={contactOptions(state.contacts, 'vendor')} />
      <Field label="Vendor's invoice number" name="reference" defaultValue={bill?.reference} required />
      <Field label="Bill date" name="billDate" type="date" defaultValue={bill?.bill_date ?? today()} required />
      <Field label="Due date" name="dueDate" type="date" defaultValue={bill?.due_date} hint="Blank uses the vendor's terms" />
      <Field label="Bill class" name="className" defaultValue={bill?.class_name} />
      <Field label="Bill memo" name="memo" defaultValue={bill?.memo} />
    </div>
    {lines.map((l, i) => <div className="grid-form line" key={i}>
      <Field label={`Line ${i + 1} description`} name={`d${i}`} value={l.description} onChange={(e: any) => set(i, { description: e.target.value })} required />
      <Field label={`Line ${i + 1} account`} name={`a${i}`} value={l.accountId} onChange={(e: any) => set(i, { accountId: e.target.value })} required options={expense} />
      <Field label={`Line ${i + 1} amount`} name={`m${i}`} value={l.amount} onChange={(e: any) => set(i, { amount: e.target.value })} required inputMode="decimal" />
    </div>)}
    <button type="button" className="btn btn-secondary" onClick={() => setLines(ls => [...ls, { description: '', accountId: '', amount: '' }])}>Add line</button>
    {!bill && <label className="check"><input type="checkbox" name="post" /> Record it now (bills matching an owner rule must first be saved as drafts)</label>}
    {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel edit</button>}
  </Form>
}

export function Bills({ data, reload, initialBillId }: { data: D; reload: () => Promise<void>; initialBillId?: string }) {
  const { state } = useShared(), file = useRef<HTMLInputElement>(null), [selected, setSelected] = useState<string | null>(() => initialBillId ?? (typeof window !== 'undefined' && window.location.hash.startsWith('#bill-') ? window.location.hash.slice(6) : null)), [editing, setEditing] = useState(false)
  const current = (data.bills as D[]).find(b => b.id === selected)
  return <>{state.actor.role !== 'payables-clerk' && <CapturedBills documents={data.capturedBills ?? []} />}<CaptureApprovalRules rules={data.approvalRules ?? []} accounts={state.accounts} onChange={reload} /><div className="split split-wide-left">
    <div className="stack"><Card title="Bills">
      <Table caption="Bill inbox" heads={['Vendor', 'Reference / evidence', 'Due', 'Amount', 'Open', 'State / next actor']} figures={[3, 4]} empty="No bills yet.">
        {(data.bills as D[]).map(b => <tr key={b.id} className={selected === b.id ? 'selected' : ''} tabIndex={0} onClick={() => { setSelected(b.id); setEditing(false) }} onKeyDown={k => { if (k.key === 'Enter') setSelected(b.id) }}>
          <td>{b.vendor_name}</td><td><span>{b.reference}</span><small className="sub block">{b.documents.length ? <Chip tone="good">Attached</Chip> : b.evidence_waived ? <Chip>Reason recorded</Chip> : <Chip tone="warn">Missing</Chip>}</small></td><td>{day(b.due_date)}</td><td className="fig">{usd(b.total_cents)}</td><td className="fig">{usd(b.open_cents)}</td>
          <td><Chip tone={['Paid', 'Reconciled'].includes(b.lifecycle.stage) ? 'good' : 'neutral'}>{b.lifecycle.stage}</Chip><small className="sub block">Next: {b.lifecycle.nextActor}</small></td></tr>)}
      </Table>
    </Card>
    {current && <VendorHistory key={current.vendor_id + current.revision} vendorId={current.vendor_id} />}
    </div><div className="stack">
      {current && <Card title={`${current.vendor_name} ${current.reference}`}>
        {current.ownerApprovalRequired && <p className="callout callout-warn">This amount exceeds your bill approval limit. The owner must approve it.</p>}
        <BillWorkflow bill={current} reload={reload} />
        <p>{usd(current.total_cents)} due {day(current.due_date)}; {usd(current.open_cents)} open.</p>
        {!!current.received && <p><Chip tone="good">Received</Chip> {current.ready_to_pay ? <Chip tone="good">Ready to pay</Chip> : <Chip>Not ready to pay</Chip>}</p>}
        {current.status === 'draft' && current.capture_receipt_id && <a href={`/app/receipts#receipt-${current.capture_receipt_id}`}>Review and approve document draft</a>}
        <Table heads={['Description', 'Account', 'Amount']} figures={[2]}>{current.lines.map((l: D) => <tr key={l.id}><td>{l.description}</td><td>{state.accounts.find((a: D) => a.id === l.account_id)?.name}</td><td className="fig">{usd(l.amount_cents)}</td></tr>)}</Table>
        {current.class_name && <p>Class: {current.class_name}</p>}
        {current.status === 'draft' && !current.capture_receipt_id && <>
          <p>{current.approved_revision === current.revision ? `This revision was approved by ${current.approved_by}.` : current.owner_required ? 'Owner approval required before posting this revision.' : 'No owner-only rule matches this revision.'}</p>
          {editing ? <BillForm key={current.revision} bill={current} onCancel={() => setEditing(false)} onDone={async () => { setEditing(false); await reload() }} /> : <div className="row-actions">
            {state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>Edit bill</button>}
            {!current.ownerApprovalRequired && current.approved_revision !== current.revision && state.actor.can.post && (state.actor.role === 'owner' || (!current.owner_required && current.prepared_by !== state.actor.email)) && <Action run={async () => { await command('bill.approve', { id: current.id, revision: current.revision }); await reload() }}>Approve bill revision</Action>}
            {!current.ownerApprovalRequired && state.actor.can.record && (!current.owner_required || current.approved_revision === current.revision) && <Action tone="primary" run={async () => { await command('bill.record', { id: current.id, revision: current.revision }); await reload() }}>Record bill</Action>}
          </div>}
        </>}
        {current.documents.map((d: D) => <p key={d.id}>{state.actor.policy?.maskTin || state.actor.policy?.maskBank ? <span>{d.name} · original restricted</span> : <a href={`/api/pantry/documents/${d.id}`}>{d.name}</a>}</p>)}
        {state.actor.can.record && <Form label="Attach source document" submit={async () => command('document.upload', { ...(await readFileBase64(file.current)), linkedKind: 'bill', linkedId: current.id })} onDone={reload}><div className="field"><label htmlFor="bill-file">Document</label><input id="bill-file" ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" required /></div></Form>}
        {!current.documents.length && !current.evidence_waived && state.actor.can.post && <Form label="Record why there is no document" submit={b => command('bill.waive-evidence', { id: current.id, revision: current.revision, ...b })} onDone={reload}><Field label="Reason" name="reason" required /></Form>}
        {current.evidence_waived && <p className="hint">No document: {current.evidence_waived}</p>}
      </Card>}
      {!editing && state.actor.can.record && <Card title="Record a bill or expense"><BillForm onDone={reload} /></Card>}
    </div>
  </div><RecurringBills templates={data.recurringBills ?? []} reload={reload} /></>
}

