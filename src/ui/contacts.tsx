import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, Chip, command, Field, Form, Table, useShared, type D } from './kit'
import { VendorHistory } from './vendor-history'
import { CustomerHistory } from './customer-history'
import { ExemptionCertificates } from './exemption-certificates'
import { GuardCard, RecordColumn, RecordLine, unknownRecordText, useGuard, useGuardDirty } from './record-layout'
import { CONTACTS_LIST } from './record-paths'

const METHODS = [['card', 'Card'], ['us_bank_account', 'Bank account (ACH)'], ['offline', 'Offline payment instructions']] as const
const ROLES = ['primary', 'billing', 'cc'] as const
const parsed = (value: any, empty: any) => typeof value === 'string' ? JSON.parse(value) : value ?? empty

function ContactEditor({ editing, onDone, onCancel }: { editing: D | null; onDone: (c: D) => Promise<void>; onCancel: () => void }) {
  const { state } = useShared(), fixedKind = state.actor.role === 'sales' ? 'customer' : state.actor.role === 'payables-clerk' ? 'vendor' : null
  const [kind, setKind] = useState(editing?.kind ?? fixedKind ?? 'customer')
  const [people, setPeople] = useState<D[]>(() => parsed(editing?.contacts_json, []))
  const [methods, setMethods] = useState<string[] | null>(() => parsed(editing?.pay_methods, null))
  const [businessReminders, setBusinessReminders] = useState(editing?.reminder_days == null)
  const [reminderDays, setReminderDays] = useState(() => (parsed(editing?.reminder_days, []) as number[]).join(', '))
  const patch = (index: number, values: D) => setPeople(p => p.map((v, i) => i === index ? { ...v, ...values } : v))
  // Text typed and not yet saved holds the editor open: every way out of the page asks first.
  const box = useRef<HTMLDivElement>(null), baseline = useRef<string | null>(null), [typed, setTyped] = useState(false), [, touch] = useState(0)
  const snapshot = () => { const form = box.current?.querySelector('form'); return JSON.stringify([form ? [...new FormData(form)].filter(([, v]) => typeof v === 'string') : [], kind, people, methods, businessReminders, reminderDays]) }
  useEffect(() => { baseline.current ??= snapshot(); setTyped(snapshot() !== baseline.current) })
  useGuardDirty(typed)
  const guard = useGuard()
  const changed = () => { baseline.current ??= snapshot(); guard?.markDirty(snapshot() !== baseline.current); touch(n => n + 1) }
  return <div ref={box} onInput={changed} onChange={changed}><Card title={editing ? `Edit ${editing.name}` : 'Add a customer or vendor'}>
    <Form label={editing ? 'Save' : 'Add'} submit={b => command('contact.save', { ...b, id: editing?.id, revision: editing?.revision, kind,
      active: b.active !== 'no', contacts: people, ...(kind === 'customer' ? { payMethods: methods, reminderDays: businessReminders ? null : reminderDays } : {}) })} onDone={onDone}
      secondary={editing && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}>
      {!editing && !fixedKind && <Field label="Kind" name="kind" value={kind} onChange={(e: any) => setKind(e.target.value)} required options={[{ value: 'customer', label: 'Customer' }, { value: 'vendor', label: 'Vendor' }]} />}
      <Field label="Name" name="name" defaultValue={editing?.name} required />
      <Field label="Email" name="email" type="email" defaultValue={editing?.email} />
      <Field label="Payment terms (days)" name="termsDays" type="number" defaultValue={editing?.terms_days ?? 30} min={0} max={365} />
      {kind === 'vendor' && ['class','location','project'].filter(kind=>state.dimensions?.settings[kind==='class'?'classes_enabled':kind==='location'?'locations_enabled':'projects_enabled']).map(kind=><Field key={kind} label={`Default ${kind}`} name={`default${kind[0].toUpperCase()+kind.slice(1)}`} defaultValue={editing?.[`default_${kind}`]??''} empty="Unassigned" options={state.dimensions.values.filter((v:D)=>v.kind===kind&&(v.active||v.name===editing?.[`default_${kind}`])).map((v:D)=>({value:v.name,label:v.name+(v.active?'':' (inactive)')}))} />)}
      {kind === 'vendor' && <>
        <Field label="Vendor phone" name="phone" defaultValue={editing?.phone} />
        <Field label="Default account" name="defaultAccountId" defaultValue={editing?.default_account_id ?? ''} empty="Not set" options={state.accounts.filter((a:D)=>a.active&&!['bank','receivable','payable'].includes(a.subtype)).map((a:D)=>({value:a.id,label:`${a.code} · ${a.name}`}))} />
        <Field label="1099 box" name="vendorTaxBox" defaultValue={editing?.vendor_tax_box ?? 'NEC-1'} options={['NEC-1','MISC-1','MISC-2','MISC-3','MISC-5','MISC-6','MISC-7','MISC-8','MISC-9','MISC-10','MISC-11','MISC-12','MISC-14','MISC-15'].map(value=>({value,label:value}))} hint="MISC classifications require separate filing review; they are excluded from NEC filing data." />
        <Field label="Payment provider" name="paymentProvider" defaultValue={editing?.payment_provider} />
        <Field label="Preferred provider payment method" name="providerPaymentMethod" defaultValue={editing?.provider_payment_method ?? ''} empty="Not recorded" options={['ach','check','wire','card','cash','payment-network'].map(value=>({value,label:value.toUpperCase()}))} hint="Records the preference only; no provider change or payment is sent." />
        {people.map((p,i)=><div key={i}><Field label={`Vendor contact ${i+1} name`} name={`vendor-contact-${i}-name`} value={p.name} onChange={(e:any)=>patch(i,{name:e.target.value})} /><Field label={`Vendor contact ${i+1} email`} name={`vendor-contact-${i}-email`} type="email" value={p.email} onChange={(e:any)=>patch(i,{email:e.target.value})} /><Field label={`Vendor contact ${i+1} phone`} name={`vendor-contact-${i}-phone`} value={p.phone} onChange={(e:any)=>patch(i,{phone:e.target.value})} /><button type="button" className="btn btn-link" onClick={()=>setPeople(ps=>ps.filter((_,n)=>n!==i))}>Remove vendor contact {i+1}</button></div>)}
        <button type="button" className="btn btn-secondary" onClick={()=>setPeople(p=>[...p,{name:'',email:'',phone:'',roles:['primary']}])}>Add vendor contact</button>
      </>}
      {kind === 'customer' && <>
        <Field label="Phone" name="phone" defaultValue={editing?.phone} />
        <Field label="Billing address" name="billingAddress" type="textarea" defaultValue={editing?.billing_address} />
        <Field label="Service address" name="serviceAddress" type="textarea" defaultValue={editing?.service_address} />
        <Field label="Internal notes" name="internalNotes" type="textarea" defaultValue={editing?.internal_notes} hint="Only inside your books. Never included on customer documents, invoice links or email." />
        <fieldset className="allocations"><legend>Invoice reminders</legend>
          <label className="check"><input type="checkbox" checked={businessReminders} onChange={e => setBusinessReminders(e.target.checked)} />Use business reminder schedule</label>
          {!businessReminders && <Field label="Customer reminder days" name="reminderDays" value={reminderDays} onChange={(e: any) => setReminderDays(e.target.value)} hint="Days from the due date: -3 is three days before, 0 the due date, 7 a week after. Leave blank for no reminders to this customer." />}
        </fieldset>
        <Field label="How their payments read on your bank statement (customers)" name="bankReference" defaultValue={editing?.bank_reference} hint="For example CEDAR STUDIO LLC. A deposit naming this, or the invoice number, clears automatically when exactly one open invoice of that amount fits. Amount-only deposits wait for confirmation." />
        <fieldset className="allocations"><legend>Payment methods offered</legend>
          <label className="check"><input type="checkbox" checked={methods === null} onChange={e => setMethods(e.target.checked ? null : METHODS.map(([id]) => id))} />All available methods</label>
          {methods !== null && METHODS.map(([id, label]) => <label className="check" key={id}><input type="checkbox" checked={methods.includes(id)} onChange={e => setMethods(m => e.target.checked ? [...m!, id] : m!.filter(x => x !== id))} />{label}</label>)}
          <p className="hint">Online methods also need a connected provider. Clearing every method removes payment options from this customer's invoice links.</p>
        </fieldset>
        <fieldset className="allocations"><legend>Contact people</legend>
          <p className="hint">Invoices and reminders go to billing and CC contacts. Without either role, they go to the customer email above.</p>
          {people.map((p, i) => <div className="stack" key={i}>
            <Field label={`Contact ${i + 1} name`} name={`person-${i}-name`} value={p.name} onChange={(e: any) => patch(i, { name: e.target.value })} required />
            <Field label={`Contact ${i + 1} email`} name={`person-${i}-email`} type="email" value={p.email} onChange={(e: any) => patch(i, { email: e.target.value })} />
            <Field label={`Contact ${i + 1} phone`} name={`person-${i}-phone`} value={p.phone} onChange={(e: any) => patch(i, { phone: e.target.value })} />
            {ROLES.map(role => <label className="check" key={role}><input type="checkbox" aria-label={`Contact ${i + 1} ${role}`} checked={p.roles.includes(role)} onChange={e => patch(i, { roles: e.target.checked ? [...p.roles, role] : p.roles.filter((r: string) => r !== role) })} />{role === 'cc' ? 'CC' : role === 'billing' ? 'Billing' : 'Primary'}</label>)}
            <button type="button" className="btn btn-link" onClick={() => setPeople(ps => ps.filter((_, index) => index !== i))}>Remove contact {i + 1}</button>
          </div>)}
          <button type="button" className="btn btn-secondary" onClick={() => setPeople(p => [...p, { name: '', email: '', phone: '', roles: ['billing'] }])}>Add contact person</button>
        </fieldset>
      </>}
      {editing && <Field label="Status" name="active" defaultValue={editing.active ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />}
    </Form>
  </Card></div>
}

const contactPath = (c: D) => c.kind === 'customer' ? { to: '/app/sales/customer/$customerId' as const, params: { customerId: c.id } } : { to: '/app/sales/vendor/$vendorId' as const, params: { vendorId: c.id } }

/** The one list of customers and vendors: today's full table, or, beside an open record, a condensed rail of rows. */
function ContactList({ contacts, selected, rail, onPick }: { contacts: D[]; selected?: string; rail?: boolean; onPick: (c: D) => void }) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    // Keep the open record's row in view inside the rail's own scroll; the page's scroll stays where it is.
    const row = list.current?.querySelector<HTMLElement>('[aria-current]'), box = list.current?.closest<HTMLElement>('.record-rail')
    if (!row || !box) return
    const top = row.offsetTop - list.current!.offsetTop
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + row.offsetHeight - box.clientHeight
  }, [selected, rail])
  const key = (c: D) => (k: React.KeyboardEvent) => { if (k.key === 'Enter' && k.target === k.currentTarget) onPick(c) }
  const status = (c: D) => c.active ? <Chip tone="good">Active</Chip> : <Chip>Inactive</Chip>
  if (rail) return <ul ref={list} className="rail-list">{contacts.map(c => <li key={c.id} className={selected === c.id ? 'selected' : ''} aria-current={selected === c.id ? 'true' : undefined} tabIndex={0} onClick={() => onPick(c)} onKeyDown={key(c)}>
    <span className="rail-text"><button type="button" className="btn btn-link" onClick={e => { e.stopPropagation(); onPick(c) }}>{c.name}</button><small>{c.kind === 'customer' ? 'Customer' : 'Vendor'} · {c.terms_days} days</small></span>{status(c)}
  </li>)}</ul>
  return <Table heads={['Name', 'Kind', 'Email', 'Terms', 'Status']} empty="No customers or vendors yet.">
    {contacts.map(c => <tr key={c.id} className={selected === c.id ? 'selected' : ''} tabIndex={0} onClick={() => onPick(c)} onKeyDown={key(c)}>
      <td><button type="button" className="btn btn-link" onClick={e => { e.stopPropagation(); onPick(c) }}>{c.name}</button></td><td>{c.kind === 'customer' ? 'Customer' : 'Vendor'}</td><td>{c.email || '—'}</td><td>{c.terms_days} days</td><td>{status(c)}</td>
    </tr>)}
  </Table>
}

/** Customers & vendors. With no record open it is today's full page; beside an open record (`rail`) it is rows only. */
export function Contacts({ selected, rail }: { selected?: string; rail?: boolean }) {
  const { state, reload } = useShared(), navigate = useNavigate(), guard = useGuard(), [added, setAdded] = useState(0)
  const open = (c: D) => { if (c.id !== selected) void navigate(contactPath(c)) }
  // An empty book opens on the add form with Name ready to type in.
  useEffect(() => { if (!rail && !state.contacts.length) document.querySelector<HTMLInputElement>('main input[name=name]')?.focus() }, [])
  if (rail) return <ContactList contacts={state.contacts} selected={selected} rail onPick={open} />
  return <>
    <GuardCard />
    <div className="split split-wide-left">
      <Card title="Customers and vendors"><ContactList contacts={state.contacts} onPick={open} /></Card>
      {state.actor.can.record && <ContactEditor key={`new-${added}`} editing={null} onCancel={() => {}} onDone={async c => { guard?.markDirty(false); await reload(); setAdded(n => n + 1); open(c) }} />}
    </div>
    {!['sales', 'payables-clerk'].includes(state.actor.role) && <ExemptionCertificates />}
  </>
}

/** A customer or vendor at its own address: the record, its editor in place, or one line saying it is not there. */
export function ContactRecord({ kind, id }: { kind: 'customer' | 'vendor'; id: string }) {
  const { state, reload } = useShared(), guard = useGuard(), [editing, setEditing] = useState(false)
  const contact = state.contacts.find((c: D) => c.id === id && c.kind === kind)
  if (!contact) return <RecordColumn list={CONTACTS_LIST}><RecordLine text={unknownRecordText(kind)} list={CONTACTS_LIST} /></RecordColumn>
  const edit = () => setEditing(true)
  return <RecordColumn list={CONTACTS_LIST}>
    {editing ? <ContactEditor key={`${contact.id}-${contact.revision}`} editing={contact} onCancel={() => setEditing(false)} onDone={async () => { guard?.markDirty(false); await reload(); setEditing(false) }} />
      : kind === 'customer' ? <CustomerHistory key={contact.id + contact.revision} customerId={contact.id} onEdit={edit} /> : <VendorHistory key={contact.id + contact.revision} vendorId={contact.id} record onEdit={edit} />}
  </RecordColumn>
}
