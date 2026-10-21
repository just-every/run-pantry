// Sales & bills: invoices and credits (sent, viewed, reminded, paid online),
// recurring invoices, bills with their evidence, payments recorded from outside
// Pantry, every delivery, and the customers and vendors behind them.
import { useState } from 'react'
import { Action, Card, Chip, command, contactOptions, Details, Field, Form, Loading, Metrics, PageHead, Table, Tabs, accountOptions, day, today, usd, useShared, useView, useWho, type D } from './kit'
import { canSelfApprove } from './issuing-limits'
import { Bills } from './bills'
import { InvoiceTemplates } from './invoice-templates'
import { InvoiceEditor } from './invoice-editor'
import { Deliveries, SendPanel } from './invoice-delivery'
import { Recurring } from './recurring'
import { ExemptionCitation } from './exemption-certificates'
import { Items } from './items'
import { Contacts } from './contacts'

function invoiceStatus(i: D): [string, 'good' | 'warn' | 'info' | 'neutral'] {
  if (i.status === 'draft') return ['Draft', 'neutral']
  if (i.status === 'approved') return ['Approved', 'info']
  if (i.kind === 'credit') return [i.open_cents ? 'Unapplied credit' : 'Applied', 'good']
  if (i.open_cents === 0) return ['Paid', 'good']
  if (i.open_cents < i.total_cents) return ['Part paid', 'warn']
  return [i.opening ? 'Open (moved in)' : 'Issued', 'info']
}

function InvoicePanel({ i, data, onChange, onEdit, onCredit }: { i: D; data: D; onChange: () => Promise<void>; onEdit: () => void; onCredit: () => void }) {
  const { state } = useShared(), who = useWho(), [label, tone] = invoiceStatus(i)
  const mayApprove = state.actor.can.post && (state.actor.role === 'owner' || i.prepared_by !== state.actor.email)
  const selfAllowed = canSelfApprove(state, i) && !(i.kind === 'credit' && data.invoices.some((target: D) => target.id === i.credit_for && target.self_approval && JSON.parse(target.self_approval).person === state.actor.email))
  const untaxed = i.lines.filter((l: D) => !l.tax_code).length
  return <Card title={<>{i.customer_name} — {i.number}</>} actions={<Chip tone={tone}>{label}</Chip>}>
    <p>{i.kind === 'credit' ? 'Credit' : 'Invoice'} for {usd(i.total_cents)}{i.kind === 'invoice' && i.status === 'issued' ? `, ${usd(i.open_cents)} open, due ` : ', due '}{day(i.due_date)}.</p>
    <ExemptionCitation invoice={i} />
    {untaxed > 0 && <div className="callout callout-warn"><strong>Tax treatment needed before approval</strong><span>{untaxed} line{untaxed === 1 ? '' : 's'} without a sales tax code.</span></div>}
    {i.lines.length > 0 && <Table heads={['Description', 'Quantity', 'Amount', 'Tax']} figures={[1, 2, 3]}>{i.lines.map((l: D) => <tr key={l.id}><td>{l.description}</td><td className="fig">{l.quantity_milli / 1000}</td><td className="fig">{usd(l.amount_cents)}</td><td className="fig">{l.tax_code === 'exempt' ? 'Exempt' : l.tax_code ? usd(l.tax_cents) : 'Needed'}</td></tr>)}</Table>}
    <div className="row-actions">
      {i.status !== 'issued' && state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={onEdit}>Edit</button>}
      {i.self_approval && <p className="hint">Self-approved within limit · {usd(JSON.parse(i.self_approval).limit)} · {JSON.parse(i.self_approval).source}</p>}
      {i.status === 'draft' && selfAllowed && <Action tone="primary" run={async () => { await command('invoice.approve-issue', { id: i.id, revision: i.revision, limitRevision: state.settings.issuingLimits.effective.revision }); await onChange() }}>Approve and issue within limit</Action>}
      {i.status === 'draft' && (mayApprove ? <Action tone="primary" run={async () => { await command('invoice.approve', { id: i.id, revision: i.revision }); await onChange() }}>Approve</Action> : <span className="hint">Approval needs the posting grant and a different person from the preparer, unless an issuing limit permits self-approval.</span>)}
      {i.status === 'approved' && state.actor.can.record && <Action tone="primary" run={async () => { await command('invoice.issue', { id: i.id }); await onChange() }}>Issue</Action>}
      {i.kind === 'invoice' && i.status === 'issued' && !i.opening && state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={onCredit}>Issue a credit</button>}
    </div>
    {i.kind === 'invoice' && i.status === 'issued' && <SendPanel i={i} data={data} onChange={onChange} />}
    <Details facts={{ id: i.id, revision: i.revision, 'prepared by': who(i.prepared_by), 'approved by': i.approved_by && who(i.approved_by), 'issued by': i.issued_by && who(i.issued_by), journal: i.journal_id, ...(i.recurring_id ? { 'recurring invoice': (data.recurring as D[]).find(t => t.id === i.recurring_id)?.number } : {}) }} />
  </Card>
}

function Invoices({ data, reload }: { data: D; reload: () => Promise<void> }) {
  const { state } = useShared()
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<{ invoice?: D; creditFor?: D } | null>(null)
  const invoices = data.invoices as D[], current = invoices.find(i => i.id === selected)
  const sum = (f: (i: D) => boolean) => invoices.filter(i => i.kind === 'invoice' && f(i)).reduce((s, i) => s + i.total_cents, 0)
  const count = (f: (i: D) => boolean) => invoices.filter(i => i.kind === 'invoice' && f(i)).length
  if (editing) return <InvoiceEditor {...editing} invoices={invoices} onCancel={() => setEditing(null)} onDone={async saved => { await reload(); setSelected(saved.id); setEditing(null) }} />
  const groups: [string, (i: D) => boolean][] = [['Draft', i => i.status === 'draft'], ['Approved', i => i.status === 'approved'], ['Issued', i => i.status === 'issued' && i.open_cents === i.total_cents], ['Part paid', i => i.status === 'issued' && i.open_cents > 0 && i.open_cents < i.total_cents], ['Paid', i => i.status === 'issued' && i.open_cents === 0]]
  return <>
    <Metrics items={groups.map(([label, f]) => ({ label, value: usd(sum(f)), note: `${count(f)} invoice${count(f) === 1 ? '' : 's'}` }))} />
    <div className="split split-wide-left">
      <Card title="Invoices" actions={state.actor.can.record && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>Create invoice</button>}>
        <Table heads={['Customer', 'Number', 'Issue date', 'Due date', 'Amount', 'Open balance', 'Status']} figures={[4, 5]} empty={state.contacts.some((c: D) => c.kind === 'customer') ? 'No invoices yet.' : 'Add a customer first, then create an invoice.'}>
          {invoices.map(i => { const [label, tone] = invoiceStatus(i); return <tr key={i.id} className={selected === i.id ? 'selected' : ''} tabIndex={0} onClick={() => setSelected(i.id)} onKeyDown={k => { if (k.key === 'Enter') setSelected(i.id) }}>
            <td>{i.customer_name}</td><td className="nowrap">{i.number}</td><td>{day(i.issue_date)}</td><td>{day(i.due_date)}</td><td className="fig">{i.kind === 'credit' ? '−' : ''}{usd(i.total_cents)}</td><td className="fig">{i.status === 'issued' ? usd(i.open_cents) : '—'}</td><td><Chip tone={tone}>{label}</Chip>{i.viewed_at ? <small className="sub"> · Viewed</small> : i.sent_at ? <small className="sub"> · Sent</small> : null}</td></tr> })}
        </Table>
      </Card>
      {current ? <InvoicePanel key={current.id + current.revision} i={current} data={data} onChange={reload} onEdit={() => setEditing({ invoice: current })} onCredit={() => setEditing({ creditFor: current })} /> : <Card title="Invoice"><p>Choose an invoice to review, approve or issue it.</p></Card>}
    </div>
  </>
}

/** A customer's open invoices or a vendor's open bills, the items a payment can pay. */
const openFor = (data: D, direction: string, contact: string): D[] => direction === 'received'
  ? (data.invoices as D[]).filter(i => i.kind === 'invoice' && i.status === 'issued' && i.open_cents > 0 && i.customer_id === contact)
  : (data.bills as D[]).filter(b => b.status !== 'void' && b.status !== 'draft' && b.open_cents > 0 && b.vendor_id === contact)

function OpenItems({ open, alloc, setAlloc, legend = 'Apply to open items' }: { open: D[]; alloc: Record<string, string>; setAlloc: (f: (a: Record<string, string>) => Record<string, string>) => void; legend?: string }) {
  return <fieldset className="allocations"><legend>{legend}</legend>{open.map(o => <div className="field" key={o.id}><label htmlFor={`al-${o.id}`}>{o.number ?? o.reference} — {usd(o.open_cents)} open</label><input id={`al-${o.id}`} inputMode="decimal" value={alloc[o.id] ?? ''} onChange={e => setAlloc(a => ({ ...a, [o.id]: e.target.value }))} /></div>)}</fieldset>
}

/** Apply what is still unapplied of a recorded payment (one recorded from a bank line, say) to open invoices or bills. */
function ApplyPayment({ p, data, onDone }: { p: D; data: D; onDone: () => Promise<void> }) {
  const open = openFor(data, p.direction, p.contact_id), [alloc, setAlloc] = useState<Record<string, string>>(() => {
    const exact = open.filter(o => o.open_cents === p.unallocated_cents)
    return exact.length === 1 ? { [exact[0].id]: (p.unallocated_cents / 100).toFixed(2) } : {}
  })
  const what = p.direction === 'received' ? 'invoices' : 'bills'
  return <Card title={`Apply the ${usd(p.amount_cents)} payment ${p.direction === 'received' ? 'from' : 'to'} ${p.contact_name}`}>
    <p>{usd(p.unallocated_cents)} of it is not applied to any of their {what} yet{p.allocations.length ? `; ${usd(p.amount_cents - p.unallocated_cents)} already is` : ''}.</p>
    {open.length ? <Form label="Apply payment" submit={() => command('payment.allocate', { paymentId: p.id, allocations: Object.entries(alloc).filter(([, v]) => v).map(([targetId, amount]) => ({ targetId, amount })) })} onDone={onDone}>
      <OpenItems open={open} alloc={alloc} setAlloc={setAlloc} legend={`Pays these open ${what}`} />
    </Form> : <p className="hint">{p.contact_name} has no open {what}. Record the {p.direction === 'received' ? 'invoice' : 'bill'} first, then apply this payment to it here.</p>}
  </Card>
}

/** What a new payment of `amount` most likely pays: the one open item it equals, or the only open item it fits. */
function likelyAllocation(open: D[], amount: string): Record<string, string> {
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, '')) * 100)
  if (!Number.isFinite(cents) || cents <= 0) return {}
  const exact = open.filter(o => o.open_cents === cents), only = open.length === 1 && cents <= open[0].open_cents ? open : []
  const target = exact.length === 1 ? exact[0] : only[0]
  return target ? { [target.id]: (cents / 100).toFixed(2) } : {}
}

function Payments({ data, reload }: { data: D; reload: () => Promise<void> }) {
  const { state } = useShared(), [direction, setDirection] = useState('received'), [contact, setContact] = useState(''), [selected, setSelected] = useState<string | null>(null)
  const [bankId, setBankId] = useState('')
  const payingBank = state.bankAccounts.find((b: D) => b.id === bankId)
  const card = direction === 'paid' && state.accounts.some((a: D) => a.id === payingBank?.account_id && a.type === 'liability')
  const open = openFor(data, direction, contact)
  const [alloc, setAllocState] = useState<Record<string, string>>({}), [formKey, setFormKey] = useState(0), [amount, setAmount] = useState(''), [typed, setTyped] = useState(false)
  // The open item the amount pays is filled in for you; once you change an allocation yourself, it is yours.
  const setAlloc = (f: (a: Record<string, string>) => Record<string, string>) => { setTyped(true); setAllocState(f) }
  const choose = (nextContact: string, nextAmount: string, nextDirection = direction) => { setTyped(false); setAllocState(likelyAllocation(openFor(data, nextDirection, nextContact), nextAmount)) }
  const current = (data.payments as D[]).find(p => p.id === selected && !p.reversal_id && p.unallocated_cents > 0)
  return <div className="split split-wide-left">
    <Card title="Payments recorded">
      <p className="hint">Payments received at your bank, paid online from an invoice link through your Stripe account, or made to vendors. Pantry records them; it never moves money itself. Choose a payment with an unapplied amount to apply it to an invoice or bill.</p>
      <Table heads={['Date', 'Direction', 'Customer or vendor', 'Bank', 'Amount', 'Unapplied']} figures={[4, 5]} empty="No payments recorded yet.">
        {(data.payments as D[]).map(p => <tr key={p.id} className={p.reversal_id ? 'muted' : selected === p.id ? 'selected' : ''} tabIndex={0} onClick={() => setSelected(p.id)} onKeyDown={k => { if (k.key === 'Enter') setSelected(p.id) }}><td>{day(p.payment_date)}</td><td>{p.direction === 'received' ? 'Received' : 'Paid'}{p.reversal_id ? ' (reversed)' : ''}</td><td>{p.contact_name}</td><td>{p.bank_name}<small className="sub block">{p.method}{p.card_last4 ? ` · …${p.card_last4}` : ''}</small></td><td className="fig">{usd(p.amount_cents)}</td><td className="fig">{usd(p.unallocated_cents)}{!p.reversal_id && p.unallocated_cents > 0 && state.actor.can.record && <> <button type="button" className="btn btn-link" onClick={() => setSelected(p.id)}>Apply</button></>}</td></tr>)}
      </Table>
    </Card>
    <div className="stack">
    {current && state.actor.can.record && <ApplyPayment key={current.id + current.unallocated_cents} p={current} data={data} onDone={async () => { setSelected(null); await reload() }} />}
    {state.actor.can.record && <Card title="Record a payment">
      <Form key={formKey} label="Record payment" submit={b => command('payment.record', { ...b, allocations: Object.entries(alloc).filter(([, v]) => v).map(([targetId, amount]) => ({ targetId, amount })) })} onDone={async () => { setAllocState({}); setTyped(false); setAmount(''); setContact(''); setBankId(''); setFormKey(k => k + 1); await reload() }}>
        <div className="grid-form">
          <Field label="Direction" name="direction" value={direction} onChange={(e: any) => { setDirection(e.target.value); setContact(''); choose('', amount, e.target.value) }} required options={[{ value: 'received', label: 'Received from a customer' }, { value: 'paid', label: 'Paid to a vendor' }]} />
          <Field label={direction === 'received' ? 'Customer' : 'Vendor'} name="contactId" value={contact} onChange={(e: any) => { setContact(e.target.value); choose(e.target.value, amount) }} required options={contactOptions(state.contacts, direction === 'received' ? 'customer' : 'vendor')} />
          <Field label="Date" name="date" type="date" defaultValue={today()} required />
          <Field label="Amount" name="amount" required inputMode="decimal" value={amount} onChange={(e: any) => { setAmount(e.target.value); if (!typed) setAllocState(likelyAllocation(open, e.target.value)) }} />
          {state.bankAccounts.length ? <Field label="Bank or card account" name="bankAccountId" required value={bankId} onChange={(e: any) => setBankId(e.target.value)} options={state.bankAccounts.map((b: D) => ({ value: b.id, label: `${b.name} (…${b.number_last4})` }))} />
            : <div role="status" className="callout callout-warn field-wide"><strong>Add a bank account first</strong><span>A payment is recorded against the bank account it went through, and this Pantry has none yet. Add one under <a href="/app/bank?tab=statements">Bank › Statements › Add a bank or card account</a>, linked to a ledger account such as 1000 Operating checking, then record the payment here.</span></div>}
          <Field label="Reference" name="reference" />
          {card ? <p className="hint">Card payment · …{payingBank.number_last4}. Kept out of 1099-NEC totals.</p> : <Field label="How it was paid" name="method" options={[{ value: 'check', label: 'Check' }, { value: 'ach', label: 'ACH' }, { value: 'wire', label: 'Wire' }, { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'payment-network', label: 'Payment network (e.g. PayPal)' }]} hint="Card and payment-network payments stay out of 1099-NEC totals" />}
        </div>
        {open.length > 0 && <><OpenItems open={open} alloc={alloc} setAlloc={setAlloc} legend={`Pays these open ${direction === 'received' ? 'invoices' : 'bills'}`} />
          <p className="hint">The {direction === 'received' ? 'invoice' : 'bill'} this amount pays is filled in, so recording the payment also marks it paid. Change the amounts, or clear them to record the payment unapplied.</p></>}
      </Form>
    </Card>}
    <VendorCredits data={data} reload={reload} />
    </div>
  </div>
}

function VendorCredits({ data, reload }: { data: D; reload: () => Promise<void> }) {
  const { state } = useShared(), [selected, setSelected] = useState(''), [alloc, setAlloc] = useState<Record<string, string>>({}), [formKey, setFormKey] = useState(0)
  const credits = (data.vendorCredits ?? []) as D[], current = credits.find(c => c.id === selected && c.unallocated_cents > 0)
  const open = current ? openFor(data, 'paid', current.vendor_id) : []
  return <Card title="Vendor credits">
    <Table heads={['Vendor', 'Reference', 'Credit', 'Unapplied']} figures={[2, 3]} empty="No vendor credits recorded.">
      {credits.map(c => <tr key={c.id}><td>{c.vendor_name}</td><td>{c.reference}</td><td className="fig">{usd(c.amount_cents)}</td><td className="fig">{usd(c.unallocated_cents)}{c.unallocated_cents > 0 && state.actor.can.record && <button type="button" className="btn btn-link" onClick={() => { setSelected(c.id); setAlloc({}) }}>Apply credit</button>}</td></tr>)}
    </Table>
    {current && state.actor.can.record && <Form label="Apply vendor credit" submit={b => command('vendor-credit.allocate', { ...b, creditId: current.id, allocations: Object.entries(alloc).filter(([, amount]) => amount).map(([targetId, amount]) => ({ targetId, amount })) })} onDone={async () => { setSelected(''); setAlloc({}); await reload() }}>
      <p>{current.vendor_name} · {current.reference}: {usd(current.unallocated_cents)} available.</p>
      <Field label="Application date" name="date" type="date" defaultValue={today()} required />
      <OpenItems open={open} alloc={alloc} setAlloc={setAlloc} legend="Apply credit to these bills" />
    </Form>}
    {state.actor.can.record && <Form key={formKey} label="Record vendor credit" submit={b => command('vendor-credit.record', b)} onDone={async () => { setFormKey(k => k + 1); await reload() }}>
      <Field label="Vendor" name="vendorId" required options={contactOptions(state.contacts, 'vendor')} />
      <Field label="Vendor's credit reference" name="reference" required />
      <Field label="Credit date" name="date" type="date" defaultValue={today()} required />
      <Field label="Credit amount" name="amount" inputMode="decimal" required />
      <Field label="Original expense or asset account" name="accountId" required options={accountOptions(state.accounts, a => ['expense', 'asset'].includes(a.type) && !['bank', 'receivable', 'payable'].includes(a.subtype))} />
    </Form>}
  </Card>
}


export function Sales({ billId }: { billId?: string } = {}) {
  // Overview's Customers and vendors step opens this page at ?tab=contacts.
  const [tab, setTab] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'templates' ? 'Invoice templates' : typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'contacts' ? 'Customers & vendors' : typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'bills' ? 'Bills' : billId ? 'Bills' : typeof window !== 'undefined' && window.location.hash.startsWith('#bill-') ? 'Bills' : 'Invoices'), { data, error, reload } = useView<D>('sales'), shared = useShared()
  const refresh = async () => { await reload(); await shared.reload() }
  return <>
    <PageHead title="Sales & bills" lead="Invoices you send and follow up, recurring invoices, bills and their evidence, and payments." />
    <Tabs tabs={['Invoices', 'Invoice templates', 'Recurring', 'Bills', 'Payments', 'Deliveries', 'Customers & vendors', 'Products & services']} current={tab} onChange={setTab} pick="Show" />
    {tab === 'Invoice templates' ? <InvoiceTemplates /> : tab === 'Customers & vendors' ? <Contacts /> : tab === 'Products & services' ? <Items /> : !data ? <Loading error={error} what="sales and bills" /> : tab === 'Invoices' ? <Invoices data={data} reload={refresh} /> : tab === 'Recurring' ? <Recurring data={data} reload={refresh} />
      : tab === 'Bills' ? <Bills initialBillId={billId} data={data} reload={refresh} /> : tab === 'Deliveries' ? <Card title="Deliveries"><p className="hint">Every invoice and reminder Pantry has sent, with the mail provider's answer. Accepted means the provider took the message, not that the customer read it; "Viewed" on an invoice means the customer opened its link.</p><Deliveries data={data} /></Card> : <Payments data={data} reload={refresh} />}
  </>
}
