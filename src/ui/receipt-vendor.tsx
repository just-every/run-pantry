// Shared vendor review for a receipt or document-to-bill draft. The containing
// page supplies live contacts and owns refreshing after the deliberate decision.
import { useState } from 'react'
import { command, Field, Form, type D } from './kit'

type Props = { r: D; accounts: D[]; vendors: D[]; onChange: () => Promise<void> }
const options = (accounts: D[]) => accounts.map(a => ({ value: a.id, label: `${a.code} · ${a.name}` }))
export function ReceiptVendor({ r, accounts, vendors, onChange }: Props) {
  const p = r.vendorProposal
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string>(p?.confirmed?.id ?? p?.matched?.id ?? (p?.state === 'new' ? 'new' : ''))
  if (!p) return null
  const selectedVendor = vendors.find(v => v.id === selected) ?? p.candidates.find((v: D) => v.id === selected)
  const defaults = selectedVendor?.defaults ?? (selectedVendor ? { accountId: selectedVendor.default_account_id, termsDays: selectedVendor.terms_days, is1099: !!selectedVendor.is_1099, className: selectedVendor.default_class } : null)
  const account = accounts.find(a => a.id === defaults?.accountId)
  const creating = selected === 'new'
  if (p.confirmed && !editing) return <section aria-label="Vendor identity">
    <p><strong>{p.confirmed.name}</strong> · vendor confirmed</p>
    <p className="hint">{p.defaults.termsDays} day terms · {p.defaults.is1099 ? '1099 vendor' : 'Not marked for 1099'}{p.defaults.className ? ` · ${p.defaults.className}` : ''}</p>
    <button className="btn btn-quiet" type="button" onClick={() => setEditing(true)}>Change vendor</button>
  </section>
  return <section aria-label="Vendor identity">
    <p><strong>{p.state === 'ambiguous' ? 'Choose the vendor' : p.state === 'new' ? 'Proposed new vendor' : 'Confirm the vendor'}</strong></p>
    <p className="hint">{p.state === 'ambiguous' ? 'These details identify more than one vendor. Review the original and choose.' : 'Confirming keeps the printed name as an alias and fills this draft with the vendor’s defaults.'}</p>
    <Form label={creating ? 'Accept new vendor' : 'Confirm vendor'} className="grid-form" submit={b => {
      if (!creating && !selectedVendor) throw new Error('Choose a vendor')
      return command('receipt.vendor-confirm', { ...b, id: r.id, revision: r.revision, ...(creating ? { create: true } : { vendorId: selected, vendorRevision: selectedVendor.revision }) })
    }} onDone={onChange}>
      <Field label="Vendor record" name="vendorChoice" value={selected} onChange={(e: any) => setSelected(e.target.value)} required options={[
        ...vendors.filter(v => v.active !== 0).map(v => ({ value: v.id, label: `${v.name}${p.candidates.some((c: D) => c.id === v.id) ? ' · possible match' : ''}` })),
        ...p.candidates.filter((c: D) => !vendors.some(v => v.id === c.id)).map((c: D) => ({ value: c.id, label: c.name })),
        { value: 'new', label: 'Create a separate new vendor' },
      ]} wide />
      {creating ? <>
        <Field label="Vendor name" name="name" required defaultValue={p.proposed.name} maxLength={200} />
        <Field label="Email read" name="email" type="email" defaultValue={p.proposed.email} maxLength={254} />
        <Field label="Mailing address read" name="address" defaultValue={p.proposed.address} maxLength={500} wide />
        <Field label="Phone read" name="phone" defaultValue={p.proposed.phone} maxLength={60} />
        <Field label="Default account" name="defaultAccountId" options={options(accounts)} defaultValue={r.read_account_id ?? ''} />
        <Field label="Payment terms (days)" name="termsDays" type="number" min={0} max={365} defaultValue="30" />
        <Field label="Default class" name="defaultClass" maxLength={100} />
        <Field label="1099 status" name="is1099" defaultValue="false" options={[{ value: 'false', label: 'Not marked for 1099' }, { value: 'true', label: '1099 vendor' }]} />
        {p.proposed.einLast4 && <p className="hint field-wide">EIN ending {p.proposed.einLast4} read from the document. Check it on the original W-9.</p>}
        {p.candidates.length > 0 && <Field label="Why this is a separate vendor" name="newVendorReason" required maxLength={300} wide />}
      </> : selectedVendor && <div className="field-wide">
        <p>{[selectedVendor.email, selectedVendor.address, selectedVendor.phone].filter(Boolean).join(' · ')}</p>
        <p className="hint">Matched by {p.candidates.find((c: D) => c.id === selected)?.reasons.join(', ') ?? 'your selection'}. {account ? `${account.code} · ${account.name}. ` : ''}{defaults?.termsDays} day terms · {defaults?.is1099 ? '1099 vendor' : 'Not marked for 1099'}{defaults?.className ? ` · ${defaults.className}` : ''}</p>
      </div>}
      <label className="field-wide"><input type="checkbox" name="confirm" required /> I checked this vendor identity against the original document.</label>
    </Form>
  </section>
}
