import { Field, type D } from './kit'

export const selectedOptions = (event: any): string[] => Array.from(event.target.selectedOptions, (o: any) => o.value).filter(Boolean)
export const ROLES = ['accountant', 'bookkeeper', 'viewer', 'owner']
export function Sharing({ roles, setRoles }: { roles: string[]; setRoles: (roles: string[]) => void }) {
  return <fieldset className="allocations"><legend>Share with roles</legend>
    <p className="hint">Leave clear for a personal report. The owner can always view and edit personal reports and packages. Shared roles can read and export; they cannot edit your definition.</p>
    {ROLES.map(role => <label key={role} className="check"><input type="checkbox" aria-label={`Share with ${role}`} checked={roles.includes(role)} onChange={e => setRoles(e.target.checked ? [...roles, role] : roles.filter(r => r !== role))} />{role.charAt(0).toUpperCase() + role.slice(1)}</label>)}
  </fieldset>
}

export function ReportLayoutEditor({ rows, setRows, accounts }: { rows: D[]; setRows: (rows: D[]) => void; accounts: D[] }) {
  const change = (i: number, patch: D) => setRows(rows.map((r, n) => n === i ? { ...r, ...patch } : r))
  const add = (kind: string) => setRows([...rows, { id: `row-${rows.length + 1}`, kind, ...(kind === 'note' ? { text: '' } : kind === 'formula' ? { label: '', expression: '', unit: 'money' } : { label: '' }) }])
  return <fieldset className="allocations"><legend>Custom layout</legend>
    <p className="hint">An empty layout shows the source report. Add account details, section subtotals, formulas and notes in reading order. Formulas reference earlier rows, for example row("revenue") - row("direct-costs"). Money is in cents; a percentage is a ratio multiplied by 100. Division by zero is undefined.</p>
    {rows.map((r, i) => <fieldset className="allocations" key={i}><legend>Layout row {i + 1} · {r.kind}</legend>
      <Field label={`Row ${i + 1} reference`} name={`row-${i}-id`} value={r.id} onChange={(e: any) => change(i, { id: e.target.value })} required />
      {r.kind === 'note' ? <Field label={`Row ${i + 1} note`} name={`row-${i}-note`} type="textarea" value={r.text} onChange={(e: any) => change(i, { text: e.target.value })} required /> : <Field label={`Row ${i + 1} label`} name={`row-${i}-label`} value={r.label ?? ''} onChange={(e: any) => change(i, { label: e.target.value })} required />}
      {(r.kind === 'accounts' || r.kind === 'section') && <>
        <Field label={`Row ${i + 1} accounts`} name={`row-${i}-accounts`} multiple value={r.accountIds ?? []} onChange={(e: any) => { const ids = selectedOptions(e); change(i, { accountIds: ids.length ? ids : undefined, rowIds: undefined }) }} options={accounts.map(a => ({ value: a.id, label: `${a.code} · ${a.name}` }))} hint="Leave empty to include all accounts that pass the report filters." />
        <Field label={`Row ${i + 1} account types`} name={`row-${i}-types`} multiple value={r.accountTypes ?? []} onChange={(e: any) => { const types = selectedOptions(e); change(i, { accountTypes: types.length ? types : undefined, rowIds: undefined }) }} options={['income', 'expense', 'asset', 'liability', 'equity'].map(value => ({ value, label: value }))} />
        {r.kind === 'section' && <Field label={`Row ${i + 1} subtotal references`} name={`row-${i}-references`} value={(r.rowIds ?? []).join(', ')} onChange={(e: any) => { const refs = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean); change(i, { rowIds: refs.length ? refs : undefined, accountIds: undefined, accountTypes: undefined }) }} hint="Optional earlier row references separated by commas, instead of selecting accounts." />}
      </>}
      {r.kind === 'formula' && <>
        <Field label={`Row ${i + 1} formula`} name={`row-${i}-formula`} value={r.expression} onChange={(e: any) => change(i, { expression: e.target.value })} required hint={'Use row("reference") or account("account ID"), numbers, + - * / and parentheses. No code is executed.'} />
        <Field label={`Row ${i + 1} unit`} name={`row-${i}-unit`} value={r.unit} onChange={(e: any) => change(i, { unit: e.target.value })} options={[{ value: 'money', label: 'USD amount' }, { value: 'ratio', label: 'Ratio' }, { value: 'percent', label: 'Percentage' }]} required />
      </>}
      <button className="btn btn-link" type="button" onClick={() => setRows(rows.filter((_, n) => i !== n))}>Remove row {i + 1}</button>
    </fieldset>)}
    <div className="row-actions">{[['accounts', 'Add account details'], ['section', 'Add section'], ['formula', 'Add formula'], ['note', 'Add note']].map(([kind, label]) => <button key={kind} type="button" className="btn btn-secondary" onClick={() => add(kind)}>{label}</button>)}</div>
  </fieldset>
}
