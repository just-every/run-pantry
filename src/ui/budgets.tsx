import { useState } from 'react'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { Card, Chip, Field, Form, Loading, Table, amountText, command, monthName, usd, useShared, useView, type D } from './kit'

type Cell = { accountId: string; month: string; amount: string;className?:string;locationName?:string }
function Editor({ selected, done, cancel }: { selected?: D; done: (saved: D) => Promise<void>; cancel: () => void }) {
  const { state } = useShared(), accounts = state.accounts.filter((a: D) => a.active && ['income', 'expense'].includes(a.type))
  const [mode, setMode] = useState('entered'), [source, setSource] = useState(''), [plan, setPlan] = useState<D | null>(null), [mapping, setMapping] = useState<D>({})
  const [start, setStart] = useState(selected?.start_month ?? `${new Date().getFullYear()}-${String(state.settings?.entity?.fiscal_year_start ?? 1).padStart(2, '0')}`)
  const months = Array.from({ length: 12 }, (_, i) => { const [y, m] = start.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7) })
  const [cells, setCells] = useState<Cell[]>(selected?.cells.map((c: D) => ({ accountId: c.account_id, month: c.month, amount: amountText(c.amount_cents),className:c.class_name,locationName:c.location_name })) ?? [])
  return <Card title={selected ? `Edit ${selected.name}` : 'New annual budget'}>
    <Form label="Save budget" submit={async b => {
      let easel: D | undefined
      if (mode === 'easel') { try { easel = JSON.parse(source) } catch { throw new Error('Paste the Easel scenario JSON response') } }
      return command('budget.save', { ...b, id: selected?.id, revision: selected?.revision, startMonth: start, cells, ...(mode === 'actuals' ? { copyActuals: true } : mode === 'csv' ? { csv: source } : mode === 'easel' ? { easel, mapping } : {}) })
    }} onDone={done} secondary={<button className="btn btn-secondary" type="button" onClick={cancel}>Cancel</button>}>
      <div className="grid-form">
        <Field label="Budget name" name="name" defaultValue={selected?.name} required />
        <Field label="Annual start" name="startMonth" type="month" value={start} readOnly={!!selected} onChange={(e: any) => { setStart(e.target.value); setCells([]) }} required />
        <Field label="Budget basis" name="basis" defaultValue={selected?.basis ?? state.settings?.entity?.tax_method ?? 'accrual'} options={[{ value: 'cash', label: 'Cash basis' }, { value: 'accrual', label: 'Accrual basis' }]} required />
        {!selected && <Field label="Start from" name="mode" value={mode} onChange={(e: any) => setMode(e.target.value)} options={[{ value: 'entered', label: 'Enter amounts' }, { value: 'actuals', label: 'Prior-year actuals' }, { value: 'csv', label: 'CSV file' }, { value: 'easel', label: 'Easel plan' }]} />}
        {mode === 'actuals' && <Field label="Percentage change" name="percentChange" defaultValue="5" inputMode="decimal" hint="Each prior-year account/month amount is adjusted and rounded to cents." />}
      </div>
      {(mode === 'csv' || mode === 'easel') && <>
        <p className="hint">{mode === 'csv' ? 'CSV columns: Account,Month,Amount, with optional Class and Location. Use chart codes, YYYY-MM and signed USD amounts. Each account/month/class/location occurs once.' : 'Save the JSON from your Easel installation’s /api/easel/scenario/SCENARIO-ID response. Only USD plans are accepted; departments are summed into each mapped account.'}</p>
        <Field label="Import file" name="file" type="file" accept={mode === 'csv' ? '.csv,text/csv' : '.json,application/json'} onChange={async (e: any) => { const file = e.target.files?.[0]; if (!file) return; const content = await file.text(); setSource(content); try { setPlan(JSON.parse(content)) } catch { setPlan(null) } }} />
        <Field label={mode === 'csv' ? 'CSV contents' : 'Easel scenario JSON'} name="source" type="textarea" value={source} onChange={(e: any) => { setSource(e.target.value); try { setPlan(JSON.parse(e.target.value)) } catch { setPlan(null) } }} required />
        {mode === 'easel' && plan?.lines?.map((line: D) => <Field key={line.id} label={`Account for ${line.name}`} name={`map-${line.id}`} required value={mapping[line.id] ?? ''} onChange={(e: any) => setMapping(m => ({ ...m, [line.id]: e.target.value }))} options={accounts.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />)}
      </>}
      {mode === 'entered' && <>
        <p className="hint">Amounts are signed USD in the account’s natural direction. Blank months are zero. Changing a budget never changes posted books.</p>
        {cells.map((cell, i) => <div className="grid-form line" key={i}>
          <Field label={`Budget line ${i + 1} account`} name={`account-${i}`} required value={cell.accountId} onChange={(e: any) => setCells(rows => rows.map((row, j) => j === i ? { ...row, accountId: e.target.value } : row))} options={accounts.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
          <Field label={`Budget line ${i + 1} month`} name={`month-${i}`} required value={cell.month} onChange={(e: any) => setCells(rows => rows.map((row, j) => j === i ? { ...row, month: e.target.value } : row))} options={months.map(m => ({ value: m, label: monthName(m) }))} />
          <Field label={`Budget line ${i + 1} amount`} name={`amount-${i}`} required inputMode="decimal" value={cell.amount} onChange={(e: any) => setCells(rows => rows.map((row, j) => j === i ? { ...row, amount: e.target.value } : row))} />
          {['class','location'].filter(kind=>state.dimensions?.settings[kind==='class'?'classes_enabled':'locations_enabled']).map(kind=><Field key={kind} label={`Budget line ${i+1} ${kind}`} name={`budget-${i}-${kind}`} value={cell[`${kind}Name` as 'className'|'locationName']??''} onChange={(e:any)=>setCells(rows=>rows.map((r,j)=>j===i?{...r,[`${kind}Name`]:e.target.value}:r))} empty="Unassigned" options={state.dimensions.values.filter((v:D)=>v.kind===kind&&v.active).map((v:D)=>({value:v.name,label:v.name}))} />)}
          <button type="button" className="btn btn-link" onClick={() => setCells(rows => rows.filter((_, j) => i !== j))}>Remove budget line {i + 1}</button>
        </div>)}
        <button type="button" className="btn btn-secondary" onClick={() => setCells(rows => [...rows, { accountId: accounts[0]?.id ?? '', month: start, amount: '0.00' }])}>Add budget amount</button>
      </>}
    </Form>
  </Card>
}
function Detail({ id, from, to, basis, edit }: { id: string; from: string; to: string; basis: 'cash' | 'accrual'; edit: (b: D) => void }) {
  const { data: plan, error: planError } = useView<D>(`budgets/${id}`)
  const valid = plan && from >= `${plan.start_month}-01` && to <= `${plan.months.at(-1)}-31`
  const search=useSearch({from:'/app/reports'}),navigate=useNavigate({from:'/app/reports'})
  const dimensionQuery=search.dimension?`&dimension=${encodeURIComponent(search.dimension)}&dimensionValue=${encodeURIComponent(search.dimensionValue??'')}`:''
  const path = `budgets/${id}/report?from=${from}&to=${to}&basis=${basis}${dimensionQuery}`
  const { data: report, error } = useView<D>(valid ? path : null)
  const { state } = useShared()
  // Every budget, actual, variance and percentage opens to the plan cells and posted lines behind it.
  const open = (accountId: string, metric: string, text: string) => <Link to="/app/reports" search={{ ...search, line: JSON.stringify([accountId, metric]), budget: id, record: undefined }} className="figure-link">{text}</Link>
  const pct = (p: number | null) => p === null ? 'Not comparable' : `${p.toFixed(2)}%`
  if (!plan) return <Loading error={planError} what="the budget" />
  return <Card title={<>{plan.name} <Chip tone="info">{basis === 'cash' ? 'Cash basis' : 'Accrual basis'}</Chip></>} actions={state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={() => edit(plan)}>Edit budget</button>}>
    <p>Annual plan: {monthName(plan.start_month)} to {monthName(plan.months.at(-1))}. Prepared on the {plan.basis} basis. Actuals use the report’s selected basis.</p>
    <p className="hint">Variance is actual minus budget; percent divides by the absolute budget. A zero budget is not comparable. Partial months use inclusive calendar days, rounded to cents per account/month.</p>
    {!valid ? <p>Choose report dates within this budget year.</p> : !report ? <Loading error={error} what="budget versus actual" /> : <>
      <Field label="Budget dimension" name="budgetDimension" value={search.dimension?JSON.stringify([search.dimension,search.dimensionValue]):''} onChange={(e:any)=>{const [dimension,dimensionValue]=e.target.value?JSON.parse(e.target.value):[];void navigate({search:{...search,dimension,dimensionValue,line:undefined,record:undefined}})}} empty="All dimensions" options={report.dimensionOptions.map((d:D)=>({value:JSON.stringify([d.kind,d.id]),label:`${d.kind} · ${d.name}`}))} />
      <a className="btn btn-secondary" href={`/api/pantry/budgets/${id}/report.csv?from=${from}&to=${to}&basis=${basis}${dimensionQuery}`} download>Download budget CSV · {basis}</a>
      <Table heads={['Account', 'Budget', 'Actual', 'Variance', 'Variance %']} figures={[1, 2, 3, 4]} empty="No planned or posted amounts in this range.">
        {[...[...report.rows, { id: 'net-income', code: '', name: 'Net income', ...report.netIncome }].map((r: D) => <tr key={r.id} className={r.id === 'net-income' ? 'total' : undefined}><td>{r.code ? `${r.code} · ` : ''}{r.name}</td><td className="fig">{open(r.id, 'budget', usd(r.budget))}</td><td className="fig">{open(r.id, 'actual', usd(r.actual))}</td><td className="fig">{open(r.id, 'variance', usd(r.variance))}</td><td className="fig">{open(r.id, 'percent', pct(r.percent))}</td></tr>)]}
      </Table>
    </>}
  </Card>
}
export function Budgets({ from, to, basis }: { from: string; to: string; basis: 'cash' | 'accrual' }) {
  const { data, error, reload } = useView<D>('budgets'), { state } = useShared()
  const [selected, setSelected] = useState<string>(''), [editing, setEditing] = useState<{ budget?: D } | null>(null)
  if (!data) return <Loading error={error} what="budgets" />
  if (editing) return <Editor selected={editing.budget} cancel={() => setEditing(null)} done={async saved => { await reload(); setSelected(saved.id); setEditing(null) }} />
  const id = selected || data.budgets[0]?.id
  return <>
    <div className="row-actions">{state.actor.can.record && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>New annual budget</button>}
      {data.budgets.length > 0 && <Field label="Annual budget" name="budget" value={id} onChange={(e: any) => setSelected(e.target.value)} options={data.budgets.map((b: D) => ({ value: b.id, label: b.name }))} />}</div>
    {id ? <Detail key={id} id={id} from={from} to={to} basis={basis} edit={budget => setEditing({ budget })} /> : <p>No budgets yet. Enter account/month amounts, copy prior-year actuals, or import a CSV or Easel plan.</p>}
  </>
}
