// Products and services (ITEM-001): what the business sells, with the rate,
// income account and sales-tax category an invoice line takes from it. An
// inactive item stays on the invoices that carry it but cannot be sold again.
import { useState } from 'react'
import { accountOptions, Card, Chip, command, Field, Form, Table, usd, useShared, type D } from './kit'

export function Items() {
  const { state, reload } = useShared(), [editing, setEditing] = useState<D | null>(null), [added, setAdded] = useState(0)
  const items: D[] = state.items ?? [], accounts = new Map(state.accounts.map((a: D) => [a.id, a]))
  const taxName = (it: D) => it.tax_category === 'non-taxable' ? 'Not taxable' : `Taxable${it.tax_code ? ' · ' + (state.taxCodes.find((t: D) => t.id === it.tax_code)?.name ?? '') : ''}`
  return <div className="split split-wide-left">
    <Card title="Products and services">
      <Table heads={['Name', 'SKU', 'Rate', 'Income account', 'Sales tax', 'Status']} figures={[2]} empty="No products or services yet. Add what you sell to fill invoice lines from it.">
        {items.map(it => { const a = accounts.get(it.income_account_id) as D | undefined; return <tr key={it.id} tabIndex={0} onClick={() => setEditing(it)} onKeyDown={k => { if (k.key === 'Enter') setEditing(it) }}>
          <td>{it.name}<small className="sub block">{it.kind === 'service' ? 'Service' : 'Non-inventory product'}{it.description ? ` · ${it.description}` : ''}</small></td><td>{it.sku ?? '—'}</td><td className="fig">{usd(it.rate_cents)}</td><td>{a ? `${a.code} · ${a.name}` : ''}</td><td>{taxName(it)}</td><td>{it.active ? <Chip tone="good">Active</Chip> : <Chip>Inactive</Chip>}</td></tr> })}
      </Table>
    </Card>
    {state.actor.can.record && <Card title={editing ? `Edit ${editing.name}` : 'Add a product or service'}>
      <Form key={editing?.id ?? `new-${added}`} label={editing ? 'Save' : 'Add'} submit={b => command('item.save', { ...b, id: editing?.id, revision: editing?.revision, active: b.active !== 'no' })} onDone={async () => { setEditing(null); setAdded(n => n + 1); await reload() }} secondary={editing && <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>}>
        <Field label="Name" name="name" defaultValue={editing?.name} required />
        <Field label="Kind" name="kind" required defaultValue={editing?.kind ?? 'service'} options={[{ value: 'service', label: 'Service' }, { value: 'non-inventory', label: 'Non-inventory product' }]} hint="Stock and cost of goods for inventory are kept in Pier." />
        <Field label="SKU (optional)" name="sku" defaultValue={editing?.sku ?? ''} />
        <Field label="Description on invoices" name="description" defaultValue={editing?.description} />
        <Field label="Default rate" name="rate" inputMode="decimal" defaultValue={editing ? (editing.rate_cents / 100).toFixed(2) : ''} required />
        <Field label="Income account" name="accountId" required defaultValue={editing?.income_account_id} options={accountOptions(state.accounts, (a: D) => a.type === 'income' && a.active)} />
        <Field label="Sales tax category" name="taxCategory" required defaultValue={editing?.tax_category ?? 'taxable'} options={[{ value: 'taxable', label: 'Taxable' }, { value: 'non-taxable', label: 'Not taxable' }]} />
        <Field label="Default sales tax code (taxable items)" name="taxCode" defaultValue={editing?.tax_code ?? ''} empty="Choose on each invoice" options={state.taxCodes.map((t: D) => ({ value: t.id, label: `${t.name} (${(t.rate_milli_percent / 1000).toFixed(3)}%)` }))} />
        {editing && <Field label="Status" name="active" defaultValue={editing.active ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} hint="An inactive item stays on invoices that already carry it." />}
      </Form>
    </Card>}
  </div>
}
