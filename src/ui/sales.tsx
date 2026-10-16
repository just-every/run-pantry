// Sales & bills: invoices and credits, bills with their evidence, payments
// recorded from outside Pantry, and the customers and vendors behind them.
import { useRef, useState } from 'react'
import { Action, Card, Chip, command, contactOptions, Details, Field, Form, Loading, Metrics, PageHead, Table, Tabs, accountOptions, day, readFileBase64, today, usd, useShared, useView, useWho, type D } from './kit'
import { InvoiceEditor } from './invoice-editor'

function invoiceStatus(i: D): [string, 'good' | 'warn' | 'info' | 'neutral'] {
  if (i.status === 'draft') return ['Draft', 'neutral']
  if (i.status === 'approved') return ['Approved', 'info']
  if (i.kind === 'credit') return [i.open_cents ? 'Unapplied credit' : 'Applied', 'good']
  if (i.open_cents === 0) return ['Paid', 'good']
  if (i.open_cents < i.total_cents) return ['Part paid', 'warn']
  return [i.opening ? 'Open (moved in)' : 'Issued', 'info']
}

function InvoicePanel({ i, onChange, onEdit, onCredit }: { i: D; onChange: () => Promise<void>; onEdit: () => void; onCredit: () => void }) {
  const { state } = useShared(), who = useWho(), [label, tone] = invoiceStatus(i)
  const mayApprove = state.actor.can.post && (state.actor.role === 'owner' || i.prepared_by !== state.actor.email)
  const untaxed = i.lines.filter((l: D) => !l.tax_code).length
  return <Card title={<>{i.customer_name} — {i.number}</>} actions={<Chip tone={tone}>{label}</Chip>}>
    <p>{i.kind === 'credit' ? 'Credit' : 'Invoice'} for {usd(i.total_cents)}{i.kind === 'invoice' && i.status === 'issued' ? `, ${usd(i.open_cents)} open, due ` : ', due '}{day(i.due_date)}.</p>
    {untaxed > 0 && <div className="callout callout-warn"><strong>Tax treatment needed before approval</strong><span>{untaxed} line{untaxed === 1 ? '' : 's'} without a sales tax code.</span></div>}
    {i.lines.length > 0 && <Table heads={['Description', 'Quantity', 'Amount', 'Tax']} figures={[1, 2, 3]}>{i.lines.map((l: D) => <tr key={l.id}><td>{l.description}</td><td className="fig">{l.quantity_milli / 1000}</td><td className="fig">{usd(l.amount_cents)}</td><td className="fig">{l.tax_code === 'exempt' ? 'Exempt' : l.tax_code ? usd(l.tax_cents) : 'Needed'}</td></tr>)}</Table>}
    <div className="row-actions">
      {i.status !== 'issued' && state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={onEdit}>Edit</button>}
      {i.status === 'draft' && (mayApprove ? <Action tone="primary" run={async () => { await command('invoice.approve', { id: i.id, revision: i.revision }); await onChange() }}>Approve</Action> : <span className="hint">Approval needs the posting grant and a different person from the preparer.</span>)}
      {i.status === 'approved' && state.actor.can.record && <Action tone="primary" run={async () => { await command('invoice.issue', { id: i.id }); await onChange() }}>Issue</Action>}
      {i.kind === 'invoice' && i.status === 'issued' && !i.opening && state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={onCredit}>Issue a credit</button>}
    </div>
    <Details facts={{ id: i.id, revision: i.revision, 'prepared by': who(i.prepared_by), 'approved by': i.approved_by && who(i.approved_by), 'issued by': i.issued_by && who(i.issued_by), journal: i.journal_id }} />
  </Card>
}

function Invoices({ data, reload }: { data: D; reload: () => Promise<void> }) {
  const { state } = useShared()
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<{ invoice?: D; creditFor?: D } | null>(null)
  const invoices = data.invoices as D[], current = invoices.find(i => i.id === selected)
  const sum = (f: (i: D) => boolean) => invoices.filter(i => i.kind === 'invoice' && f(i)).reduce((s, i) => s + i.total_cents, 0)
  const count = (f: (i: D) => boolean) => invoices.filter(i => i.kind === 'invoice' && f(i)).length
  if (editing) return <InvoiceEditor {...editing} onCancel={() => setEditing(null)} onDone={async saved => { setEditing(null); await reload(); setSelected(saved.id) }} />
  const groups: [string, (i: D) => boolean][] = [['Draft', i => i.status === 'draft'], ['Approved', i => i.status === 'approved'], ['Issued', i => i.status === 'issued' && i.open_cents === i.total_cents], ['Part paid', i => i.status === 'issued' && i.open_cents > 0 && i.open_cents < i.total_cents], ['Paid', i => i.status === 'issued' && i.open_cents === 0]]
  return <>
    <Metrics items={groups.map(([label, f]) => ({ label, value: usd(sum(f)), note: `${count(f)} invoice${count(f) === 1 ? '' : 's'}` }))} />
    <div className="split split-wide-left">
      <Card title="Invoices" actions={state.actor.can.record && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>Create invoice</button>}>
        <Table heads={['Customer', 'Number', 'Issue date', 'Due date', 'Amount', 'Open balance', 'Status']} figures={[4, 5]} empty={state.contacts.some((c: D) => c.kind === 'customer') ? 'No invoices yet.' : 'Add a customer first, then create an invoice.'}>
          {invoices.map(i => { const [label, tone] = invoiceStatus(i); return <tr key={i.id} className={selected === i.id ? 'selected' : ''} tabIndex={0} onClick={() => setSelected(i.id)} onKeyDown={k => { if (k.key === 'Enter') setSelected(i.id) }}>
            <td>{i.customer_name}</td><td className="nowrap">{i.number}</td><td>{day(i.issue_date)}</td><td>{day(i.due_date)}</td><td className="fig">{i.kind === 'credit' ? '−' : ''}{usd(i.total_cents)}</td><td className="fig">{i.status === 'issued' ? usd(i.open_cents) : '—'}</td><td><Chip tone={tone}>{label}</Chip></td></tr> })}
        </Table>
      </Card>
      {current ? <InvoicePanel key={current.id + current.revision} i={current} onChange={reload} onEdit={() => setEditing({ invoice: current })} onCredit={() => setEditing({ creditFor: current })} /> : <Card title="Invoice"><p>Choose an invoice to review, approve or issue it.</p></Card>}
    </div>
  </>
}

function BillForm({ onDone }: { onDone: () => Promise<void> }) {
  const { state } = useShared(), [lines, setLines] = useState([{ description: '', accountId: '', amount: '' }])
  const set = (i: number, patch: D) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  const expense = accountOptions(state.accounts, a => !['bank', 'receivable', 'payable'].includes(a.subtype) && (a.type === 'expense' || a.type === 'asset'))
  return <Form label="Record bill" submit={b => command('bill.save', { ...b, post: b.post === 'on', lines })} onDone={async () => { setLines([{ description: '', accountId: '', amount: '' }]); await onDone() }}>
    <div className="grid-form">
      <Field label="Vendor" name="vendorId" required options={contactOptions(state.contacts, 'vendor')} />
      <Field label="Vendor's invoice number" name="reference" required />
      <Field label="Bill date" name="billDate" type="date" defaultValue={today()} required />
      <Field label="Due date" name="dueDate" type="date" hint="Blank uses the vendor's terms" />
    </div>
    {lines.map((l, i) => <div className="grid-form line" key={i}>
      <Field label={`Line ${i + 1} description`} name={`d${i}`} value={l.description} onChange={(e: any) => set(i, { description: e.target.value })} required />
      <Field label={`Line ${i + 1} account`} name={`a${i}`} value={l.accountId} onChange={(e: any) => set(i, { accountId: e.target.value })} required options={expense} />
      <Field label={`Line ${i + 1} amount`} name={`m${i}`} value={l.amount} onChange={(e: any) => set(i, { amount: e.target.value })} required inputMode="decimal" />
    </div>)}
    <button type="button" className="btn btn-secondary" onClick={() => setLines(ls => [...ls, { description: '', accountId: '', amount: '' }])}>Add line</button>
    <label className="check"><input type="checkbox" name="post" defaultChecked /> Record it now (post to payables)</label>
  </Form>
}

function Bills({ data, reload }: { data: D; reload: () => Promise<void> }) {
  const { state } = useShared(), file = useRef<HTMLInputElement>(null), [selected, setSelected] = useState<string | null>(null)
  const current = (data.bills as D[]).find(b => b.id === selected)
  return <div className="split split-wide-left">
    <Card title="Bills">
      <Table heads={['Vendor', 'Reference', 'Bill date', 'Due', 'Amount', 'Open', 'Evidence', 'Status']} figures={[4, 5]} empty="No bills yet.">
        {(data.bills as D[]).map(b => <tr key={b.id} className={selected === b.id ? 'selected' : ''} tabIndex={0} onClick={() => setSelected(b.id)} onKeyDown={k => { if (k.key === 'Enter') setSelected(b.id) }}>
          <td>{b.vendor_name}</td><td className="nowrap">{b.reference}</td><td>{day(b.bill_date)}</td><td>{day(b.due_date)}</td><td className="fig">{usd(b.total_cents)}</td><td className="fig">{usd(b.open_cents)}</td>
          <td>{b.documents.length ? <Chip tone="good">Attached</Chip> : b.evidence_waived ? <Chip>Reason recorded</Chip> : <Chip tone="warn">Missing</Chip>}</td>
          <td>{b.status === 'void' ? <Chip>Void</Chip> : b.status === 'draft' ? <Chip>Draft</Chip> : b.open_cents === 0 ? <Chip tone="good">Paid</Chip> : <Chip tone="info">{b.opening ? 'Open (moved in)' : 'To pay'}</Chip>}</td></tr>)}
      </Table>
    </Card>
    <div className="stack">
      {current && <Card title={`${current.vendor_name} ${current.reference}`}>
        <p>{usd(current.total_cents)} due {day(current.due_date)}; {usd(current.open_cents)} open.</p>
        {current.status === 'draft' && state.actor.can.record && <Action tone="primary" run={async () => { await command('bill.record', { id: current.id, revision: current.revision }); await reload() }}>Record bill</Action>}
        {current.documents.map((d: D) => <p key={d.id}><a href={`/api/pantry/documents/${d.id}`}>{d.name}</a></p>)}
        {state.actor.can.record && <Form label="Attach source document" submit={async () => command('document.upload', { ...(await readFileBase64(file.current)), linkedKind: 'bill', linkedId: current.id })} onDone={reload}><div className="field"><label htmlFor="bill-file">Document</label><input id="bill-file" ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv" required /></div></Form>}
        {!current.documents.length && !current.evidence_waived && state.actor.can.post && <Form label="Record why there is no document" submit={b => command('bill.waive-evidence', { id: current.id, revision: current.revision, ...b })} onDone={reload}><Field label="Reason" name="reason" required /></Form>}
        {current.evidence_waived && <p className="hint">No document: {current.evidence_waived}</p>}
      </Card>}
      {state.actor.can.record && <Card title="Record a bill or expense"><BillForm onDone={reload} /></Card>}
    </div>
  </div>
}

function Payments({ data, reload }: { data: D; reload: () => Promise<void> }) {
  const { state } = useShared(), [direction, setDirection] = useState('received'), [contact, setContact] = useState('')
  const open = direction === 'received' ? (data.invoices as D[]).filter(i => i.kind === 'invoice' && i.status === 'issued' && i.open_cents > 0 && i.customer_id === contact) : (data.bills as D[]).filter(b => b.status !== 'void' && b.status !== 'draft' && b.open_cents > 0 && b.vendor_id === contact)
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  return <div className="split split-wide-left">
    <Card title="Payments recorded">
      <p className="hint">Pantry records payments that happened at your bank or card processor. It never moves money.</p>
      <Table heads={['Date', 'Direction', 'Customer or vendor', 'Bank', 'Amount', 'Unallocated']} figures={[4, 5]} empty="No payments recorded yet.">
        {(data.payments as D[]).map(p => <tr key={p.id} className={p.reversal_id ? 'muted' : ''}><td>{day(p.payment_date)}</td><td>{p.direction === 'received' ? 'Received' : 'Paid'}{p.reversal_id ? ' (reversed)' : ''}</td><td>{p.contact_name}</td><td>{p.bank_name}</td><td className="fig">{usd(p.amount_cents)}</td><td className="fig">{usd(p.unallocated_cents)}</td></tr>)}
      </Table>
    </Card>
    {state.actor.can.record && <Card title="Record a payment">
      <Form label="Record payment" submit={b => command('payment.record', { ...b, allocations: Object.entries(alloc).filter(([, v]) => v).map(([targetId, amount]) => ({ targetId, amount })) })} onDone={async () => { setAlloc({}); await reload() }}>
        <div className="grid-form">
          <Field label="Direction" name="direction" value={direction} onChange={(e: any) => { setDirection(e.target.value); setContact(''); setAlloc({}) }} required options={[{ value: 'received', label: 'Received from a customer' }, { value: 'paid', label: 'Paid to a vendor' }]} />
          <Field label={direction === 'received' ? 'Customer' : 'Vendor'} name="contactId" value={contact} onChange={(e: any) => { setContact(e.target.value); setAlloc({}) }} required options={contactOptions(state.contacts, direction === 'received' ? 'customer' : 'vendor')} />
          <Field label="Date" name="date" type="date" defaultValue={today()} required />
          <Field label="Amount" name="amount" required inputMode="decimal" />
          <Field label="Bank account" name="bankAccountId" required options={state.bankAccounts.map((b: D) => ({ value: b.id, label: b.name }))} />
          <Field label="Reference" name="reference" />
          <Field label="How it was paid" name="method" options={[{ value: 'check', label: 'Check' }, { value: 'ach', label: 'ACH' }, { value: 'wire', label: 'Wire' }, { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'payment-network', label: 'Payment network (e.g. PayPal)' }]} hint="Card and payment-network payments stay out of 1099-NEC totals" />
        </div>
        {open.length > 0 && <fieldset className="allocations"><legend>Apply to open items</legend>{open.map(o => <div className="field" key={o.id}><label htmlFor={`al-${o.id}`}>{o.number ?? o.reference} — {usd(o.open_cents)} open</label><input id={`al-${o.id}`} inputMode="decimal" value={alloc[o.id] ?? ''} onChange={e => setAlloc(a => ({ ...a, [o.id]: e.target.value }))} /></div>)}</fieldset>}
      </Form>
    </Card>}
  </div>
}

function Contacts() {
  const { state, reload } = useShared(), [editing, setEditing] = useState<D | null>(null)
  return <div className="split split-wide-left">
    <Card title="Customers and vendors">
      <Table heads={['Name', 'Kind', 'Email', 'Terms', 'Status']} empty="No customers or vendors yet.">
        {state.contacts.map((c: D) => <tr key={c.id} tabIndex={0} onClick={() => setEditing(c)} onKeyDown={k => { if (k.key === 'Enter') setEditing(c) }}><td>{c.name}</td><td>{c.kind === 'customer' ? 'Customer' : 'Vendor'}</td><td>{c.email || '—'}</td><td>{c.terms_days} days</td><td>{c.active ? <Chip tone="good">Active</Chip> : <Chip>Inactive</Chip>}</td></tr>)}
      </Table>
    </Card>
    {state.actor.can.record && <Card title={editing ? `Edit ${editing.name}` : 'Add a customer or vendor'}>
      <Form key={editing?.id ?? 'new'} label={editing ? 'Save' : 'Add'} submit={b => command('contact.save', { ...b, id: editing?.id, revision: editing?.revision, kind: editing?.kind ?? b.kind, active: b.active !== 'no' })} onDone={async () => { setEditing(null); await reload() }} secondary={editing && <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>}>
        {!editing && <Field label="Kind" name="kind" required options={[{ value: 'customer', label: 'Customer' }, { value: 'vendor', label: 'Vendor' }]} />}
        <Field label="Name" name="name" defaultValue={editing?.name} required />
        <Field label="Email" name="email" type="email" defaultValue={editing?.email} />
        <Field label="Payment terms (days)" name="termsDays" type="number" defaultValue={editing?.terms_days ?? 30} min={0} max={365} />
        {editing && <Field label="Status" name="active" defaultValue={editing.active ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />}
      </Form>
    </Card>}
  </div>
}

export function Sales() {
  const [tab, setTab] = useState('Invoices'), { data, error, reload } = useView<D>('sales'), shared = useShared()
  const refresh = async () => { await reload(); await shared.reload() }
  return <>
    <PageHead title="Sales & bills" lead="Invoices and credits, bills and their evidence, and payments that happened outside Pantry." />
    <Tabs tabs={['Invoices', 'Bills', 'Payments', 'Customers & vendors']} current={tab} onChange={setTab} />
    {tab === 'Customers & vendors' ? <Contacts /> : !data ? <Loading error={error} what="sales and bills" /> : tab === 'Invoices' ? <Invoices data={data} reload={refresh} /> : tab === 'Bills' ? <Bills data={data} reload={refresh} /> : <Payments data={data} reload={refresh} />}
  </>
}
