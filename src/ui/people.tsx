import { useState } from 'react'
import { Action, Card, Chip, command, Field, Form, ROLE_LABEL, Table, useShared, type D } from './kit'
import { Icon } from './icons'

export function People() {
  const { state, reload } = useShared(), members = state.settings.members
  const [editing, setEditing] = useState<D | null>(null), [invited, setInvited] = useState<D | null>(null), [added, setAdded] = useState(0)
  return <Card title={<><Icon name="people" /> People</>}>
    <Table heads={['Name', 'Email', 'Role', 'Grants', 'Status', '']} empty="Only the owner so far. Add a bookkeeper or accountant.">
      {members.map((m: D) => <tr key={m.email}><td>{m.name}</td><td>{m.email}</td><td>{ROLE_LABEL[m.role]}</td><td>{[m.can_post && 'Post', m.can_lock && 'Lock', m.can_reopen && 'Reopen'].filter(Boolean).join(', ') || '—'}</td><td>{m.active ? <Chip tone="good">Active</Chip> : <Chip>Inactive</Chip>}</td>
        <td><div className="row-actions"><button type="button" className="btn btn-link" onClick={() => setEditing(m)}>Edit</button>{m.active ? <Action run={async () => { setInvited(null); setInvited(await command('member.invite', { email: m.email })) }}>Send sign-in invitation</Action> : null}</div></td></tr>)}
    </Table>
    {invited && (invited.emailed ? <p role="status" className="hint">Sign-in invitation emailed to {invited.invited}.</p>
      : <div role="status" className="callout callout-warn"><strong>{invited.name} can sign in; no email was sent</strong><span>Pantry on this computer sends no email. To work as {invited.name} here, choose <a href="/signout">Sign out or switch person</a> (under More), then Switch person and Sign in as {invited.name}. Once Pantry is hosted with a mail provider, invitations reach their mailbox.</span>
        <details className="setup-steps"><summary>Set up: sign in as them from the command line</summary><p className="hint">Stop Pantry and run <code>rer dev --as {invited.invited}</code>.</p></details></div>)}
    <Form key={editing?.email ?? `new-${added}`} label={editing ? 'Save person' : 'Add person'} submit={b => command('member.save', { ...b, previousEmail: editing?.email, bankAccounts: b.bankAccess === 'all' ? null : state.bankAccounts.filter((a: D) => b['bank:' + a.id] === 'on').map((a: D) => a.id), canPost: b.canPost === 'on', canLock: b.canLock === 'on', canReopen: b.canReopen === 'on', active: b.active !== 'no' })} onDone={async r => { setEditing(null); setAdded(n => n + 1); setInvited(r?.invited ? r : null); await reload() }} className="grid-form"
      secondary={editing && <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>}>
      <Field label="Name" name="name" defaultValue={editing?.name} required />
      <Field label="Email" name="email" type="email" defaultValue={editing?.email} required />
      <Field label="Role" name="role" defaultValue={editing?.role} required options={[{ value: 'bookkeeper', label: 'Bookkeeper — records and prepares' }, { value: 'accountant', label: 'Accountant — reviews and posts' }, { value: 'viewer', label: 'Viewer — read only' }, { value: 'sales', label: 'Sales — customers and invoices, no banking' }, { value: 'payables-clerk', label: 'Payables clerk — vendors and bills, no payment approval' }, { value: 'time-only', label: 'Time tracking only — hours, no financial screens or rates' }]} />
      <fieldset className="checks"><legend>Grants</legend>
        <label><input type="checkbox" name="canPost" defaultChecked={!!editing?.can_post} /> Post and approve entries</label>
        <label><input type="checkbox" name="canLock" defaultChecked={!!editing?.can_lock} /> Lock periods</label>
        <label><input type="checkbox" name="canReopen" defaultChecked={!!editing?.can_reopen} /> Approve reopening</label>
      </fieldset>
      <Field label="Bill approval limit (USD)" name="billLimit" inputMode="decimal" defaultValue={editing?.bill_limit_cents == null ? '' : (editing.bill_limit_cents / 100).toFixed(2)} hint="Blank keeps the posting grant unrestricted by amount; zero permits no amount" />
      <Field label="Payment approval limit (USD)" name="paymentLimit" inputMode="decimal" defaultValue={editing?.payment_limit_cents == null ? '' : (editing.payment_limit_cents / 100).toFixed(2)} />
      <Field label="Journal approval limit (USD)" name="journalLimit" inputMode="decimal" defaultValue={editing?.journal_limit_cents == null ? '' : (editing.journal_limit_cents / 100).toFixed(2)} />
      <fieldset className="checks"><legend>Bank visibility</legend><Field label="Accounts they may see" name="bankAccess" defaultValue={editing?.bank_accounts == null ? 'all' : 'selected'} options={[{ value: 'all', label: 'All bank accounts' }, { value: 'selected', label: 'Only checked accounts' }]} hint="Choose only checked accounts to limit access. No checks means no bank accounts. Sales and time roles always have no banking access." />{state.bankAccounts.map((a: D) => <label key={a.id}><input type="checkbox" name={'bank:' + a.id} defaultChecked={editing?.bank_accounts != null && JSON.parse(editing.bank_accounts).includes(a.id)} /> {a.name}</label>)}</fieldset>
      <Field label="Time may be recorded for" name="timePeople" defaultValue={editing?.time_people ? JSON.parse(editing.time_people).join(', ') : ''} hint="The person can always record their own time. Add other people's email addresses, separated by commas." />
      {editing && <Field label="Status" name="active" defaultValue={editing.active ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />}
    </Form>
    <p className="hint">Adding someone sends them a one-time sign-in link by email; <strong>Send sign-in invitation</strong> sends a fresh one. Roles take effect on the person's next request.</p>
  </Card>
}


export function RolePrivacy() {
  const { state, reload } = useShared()
  return <Card title="Role privacy"><p>Mask tax identities and bank numbers on every response for the selected role. Owners retain access.</p>{state.settings.rolePrivacy.map((r: D) => <Form key={r.role + r.revision} label={`Save ${ROLE_LABEL[r.role] ?? r.role} privacy`} submit={b => command('role-privacy.save', { ...b, role: r.role, revision: r.revision, maskTin: b.maskTin === 'on', maskBank: b.maskBank === 'on' })} onDone={reload} className="grid-form"><fieldset className="checks"><legend>{ROLE_LABEL[r.role] ?? r.role}</legend><label><input name="maskTin" type="checkbox" defaultChecked={!!r.mask_tin} /> Mask TINs</label><label><input name="maskBank" type="checkbox" defaultChecked={!!r.mask_bank} /> Mask bank numbers</label></fieldset></Form>)}</Card>
}
