import { DimensionSelection } from './dimensions'
import { useState } from 'react'
import { Card, command, Field, Form, today, useShared, type D } from './kit'
import { ReportLayoutEditor, selectedOptions, Sharing } from './report-layout-editor'

const SOURCES = [['profit-and-loss', 'Profit and loss'], ['balance-sheet', 'Balance sheet'], ['trial-balance', 'Trial balance'], ['sales-by-customer', 'Sales by customer'], ['expenses-by-vendor', 'Expenses by vendor']]
const PERIODS = [['single', 'One period'], ['prior-period', 'Prior period'], ['prior-year', 'Prior year'], ['months', 'Fiscal year months'], ['quarters', 'Fiscal year quarters'], ['ytd', 'Year to date'], ['customer', 'Customers'], ['class','Classes'], ['location','Locations'], ['project','Projects']]

export function CustomReportEditor({ saved, onDone, onCancel }: { saved?: D; onDone: (saved: D) => Promise<void>; onCancel: () => void }) {
  const { state } = useShared(), d = saved?.definition ?? {}, [source, setSource] = useState(d.source ?? 'profit-and-loss')
  const [columns, setColumns] = useState<string[]>(d.columns ?? ['code', 'name', 'amount']), [allColumns, setAllColumns] = useState(d.allColumns === true)
  const [comparison, setComparison] = useState(d.comparison ?? 'single'), [grouping, setGrouping] = useState(d.grouping ?? 'account')
  const [accountIds, setAccounts] = useState<string[]>(d.filters?.accountIds ?? []), [contactIds, setContacts] = useState<string[]>(d.filters?.contactIds ?? [])
  const [rows, setRows] = useState<D[]>(d.layout ?? []), [roles, setRoles] = useState<string[]>(saved?.shared_roles ?? [])
  const [dimensionFilter,setDimensionFilter]=useState(d.filters?.dimension?JSON.stringify([d.filters.dimension,d.filters.dimensionValue]):'')
  const dimensionValues=dimensionFilter?JSON.parse(dimensionFilter):[]
  const contactSource = source === 'sales-by-customer' || source === 'expenses-by-vendor'
  return <Card title={saved ? `Edit ${saved.name}` : 'New custom report'}>
    <Form label="Save custom report" submit={b => command('custom-report.save', { id: saved?.id, revision: saved?.revision, sharedRoles: roles, definition: {
      name: b.name, source, from: b.from, to: b.to, ...(b.basis ? { basis: b.basis } : {}), comparison, grouping,
      ...(allColumns ? { allColumns: true } : { columns }), filters: { ...(dimensionFilter?{dimension:dimensionValues[0],dimensionValue:dimensionValues[1]}:{}), ...(accountIds.length ? { accountIds } : {}), ...(contactIds.length ? { contactIds } : {}) },
      ...(rows.length ? { layout: rows } : {}), notes: String(b.notes ?? '').split('\n').map(s => s.trim()).filter(Boolean),
    } })} onDone={onDone} secondary={<button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}>
      <div className="grid-form">
        <Field label="Report name" name="name" defaultValue={saved?.name} required />
        <Field label="Report source" name="source" value={source} onChange={(e: any) => { setSource(e.target.value); setAccounts([]); setContacts([]); setComparison('single'); setGrouping('account') }} options={SOURCES.map(([value, label]) => ({ value, label }))} required />
        <Field label="From" name="from" type="date" defaultValue={d.from ?? today().slice(0, 8) + '01'} required />
        <Field label="To" name="to" type="date" defaultValue={d.to ?? today()} required />
        <Field label="Report basis" name="basis" defaultValue={d.basis ?? ''} empty="Use the business's declared default" options={[{ value: 'cash', label: 'Cash' }, { value: 'accrual', label: 'Accrual' }]} />
        <Field label="Group by" name="grouping" value={grouping} onChange={(e: any) => setGrouping(e.target.value)} options={[{ value: 'account', label: contactSource ? 'Contact' : 'Account' }, { value: 'section', label: 'Section' }, ...((source === 'profit-and-loss' || contactSource) ? [{ value: 'customer', label: 'Customer or vendor' }] : [])]} required />
        {<Field label="Period columns" name="comparison" value={comparison} onChange={(e: any) => { setComparison(e.target.value); setAllColumns(e.target.value !== 'single');if(['class','location','project'].includes(e.target.value))setDimensionFilter('') }} options={PERIODS.filter(([id])=>['profit-and-loss','balance-sheet'].includes(source)||['single','class','location','project'].includes(id)).filter(([id])=>!['class','location','project'].includes(id)||state.dimensions?.settings[`${id==='class'?'classes':id==='location'?'locations':'projects'}_enabled`]).filter(([id]) => source === 'profit-and-loss' || id !== 'customer').map(([value, label]) => ({ value, label }))} required />}
      </div>
      <fieldset className="allocations"><legend>Columns</legend>
        <label className="check"><input type="checkbox" checked={allColumns} onChange={e => setAllColumns(e.target.checked)} />Show all available columns</label>
        {!allColumns && [['code', 'Code'], ['name', 'Name'], ['amount', 'Amount'], ['share', 'Share of total']].map(([id, label]) => <label className="check" key={id}><input type="checkbox" aria-label={`Column ${label}`} checked={columns.includes(id)} onChange={e => setColumns(e.target.checked ? [...columns, id] : columns.filter(c => c !== id))} />{label}</label>)}
      </fieldset>
      {!['class','location','project'].includes(comparison)&&<DimensionSelection label="Custom dimension filter" value={dimensionFilter} onChange={setDimensionFilter} />}
      {!contactSource && <Field label="Filter accounts" name="accounts" multiple value={accountIds} onChange={(e: any) => setAccounts(selectedOptions(e))} options={state.accounts.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} hint="Leave empty for all accounts." />}
      {(source === 'profit-and-loss' || contactSource) && <Field label="Filter contacts" name="contacts" multiple value={contactIds} onChange={(e: any) => setContacts(selectedOptions(e))} options={state.contacts.filter((c: D) => c.kind === (source === 'expenses-by-vendor' ? 'vendor' : 'customer')).map((c: D) => ({ value: c.id, label: c.name }))} hint="Leave empty for all contacts." />}
      <ReportLayoutEditor rows={rows} setRows={setRows} accounts={state.accounts} />
      <Field label="Report notes" name="notes" type="textarea" defaultValue={(d.notes ?? []).join('\n')} />
      <Sharing roles={roles} setRoles={setRoles} />
    </Form>
  </Card>
}
