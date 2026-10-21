// The generic spreadsheet path uses the same staged journal and sign-off as the
// source-specific kits, with editable headers and an inspectable preview of all rows.
import { useState } from 'react'
import { Action, Card, Chip, command, Field, Table, useShared, usd, type D } from './kit'

const LISTS = [['customers', 'Customers'], ['vendors', 'Vendors'], ['items', 'Items'], ['accounts', 'Chart of accounts'], ['openInvoices', 'Open invoices'], ['unpaidBills', 'Open bills'], ['trialBalance', 'Opening trial balance']] as const
const LABELS = Object.fromEntries(LISTS)
type Upload = { file: D; headers: string[]; fields: string[]; mapping: D; saved: boolean; rows: number }
const blankBank = () => ({ account: '', institution: '', last4: '', statementBalance: '' })

async function uploadFile(file: File): Promise<D> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return { name: file.name, content: await file.text() }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { name: file.name, base64: btoa(binary) }
}
async function downloadTemplate(dataset: string) {
  const template = await command('move-in.spreadsheet.template', { dataset }), url = URL.createObjectURL(new Blob([template.content], { type: template.contentType }))
  const a = document.createElement('a'); a.href = url; a.download = template.name; a.click(); URL.revokeObjectURL(url)
}

export function MoveInSpreadsheets({ status, reload }: { status: D; reload: () => Promise<void> }) {
  const shared = useShared(), [uploads, setUploads] = useState<Record<string, Upload>>({}), [cutoverDate, setDate] = useState('')
  const [banks, setBanks] = useState([blankBank()]), [preview, setPreview] = useState<D | null>(null), [pkg, setPkg] = useState<D | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(''), [leaveOut, setLeaveOut] = useState(false)
  const [rowPage, setRowPage] = useState(0), [rowFilter, setRowFilter] = useState('all')
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const invalidate = () => { setPreview(null); setLeaveOut(false) }
  const saveMapping = async (key: string, upload: Upload) => { await command('move-in.spreadsheet.mapping', { dataset: key, columns: upload.mapping }); setUploads(current => ({ ...current, [key]: { ...current[key], saved: true } })) }
  const resume = async (initial: D) => {
    let job = initial
    while (job.state === 'queued' || job.state === 'applying') { setProgress(`Importing ${job.checkpoint} of ${job.total} records…`); job = (await command('move-in.continue', { jobId: job.id })).job }
    if (job.state !== 'completed') throw new Error(`Import stopped: ${job.error || job.state}. Its journal is available below.`)
    setProgress(''); invalidate(); await reload()
  }
  const pending = status.jobs.find((j: D) => j.source === 'spreadsheet' && ['queued', 'applying', 'failed'].includes(j.state))
  const undoing = status.jobs.find((j: D) => j.source === 'spreadsheet' && j.state === 'undoing')
  const rows = (preview?.rows ?? []).filter((r: D) => rowFilter === 'all' || r.status === rowFilter), pageRows = rows.slice(rowPage * 25, rowPage * 25 + 25)
  return <>
    <Card title="Import spreadsheets">
      <p>Choose CSV or Excel (.xlsx) files for the lists you need. Use one sheet per list, with headers on the first row. Download a template to see the fields. Formulas must be replaced with values.</p>
      <p className="hint">For open invoices and bills, upload an opening trial balance too. Open amounts must equal its receivables and payables. Use “included” for tax already included in an open amount, or “non-taxable”; items use “taxable” or “non-taxable”. Chart types are asset, liability, equity, income and expense; roles are other, bank, receivable, payable, tax and retained.</p>
      <Field label="Spreadsheet cutover date" name="spreadsheet-cutover" type="date" value={cutoverDate} onChange={(e: any) => { setDate(e.target.value); invalidate() }} required />
      {pending && <div className="row-actions"><Chip tone="warn">{pending.checkpoint} of {pending.total} records imported</Chip><button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const result = await command('move-in.continue', { jobId: pending.id }); await resume(result.job) })}>Continue spreadsheet import</button></div>}
      {undoing && shared.state.actor.can.post && <Action run={async () => { let result = await command('move-in.undo', { jobId: undoing.id }); while (result.job.state === 'undoing') result = await command('move-in.undo', { jobId: undoing.id }); await reload() }}>Continue undo</Action>}
    </Card>
    <div className="split even">{LISTS.map(([key, label]) => {
      const upload = uploads[key]
      return <Card key={key} title={label} actions={<Action run={() => downloadTemplate(key)}>Download template</Action>}>
        <div className="field"><label htmlFor={`spreadsheet-${key}`}>{label} spreadsheet</label><input id={`spreadsheet-${key}`} type="file" accept=".csv,.xlsx" disabled={busy} onChange={e => {
          const file = e.target.files?.[0]; invalidate()
          if (!file) { setUploads(current => { const next = { ...current }; delete next[key]; return next }); return }
          void run(async () => { const data = await uploadFile(file), inspected = await command('move-in.spreadsheet.inspect', { dataset: key, file: data }); setUploads(current => ({ ...current, [key]: { file: data, headers: inspected.headers, fields: inspected.fields, mapping: inspected.mapping, rows: inspected.rows, saved: JSON.stringify(inspected.mapping) === JSON.stringify(inspected.saved) } })) })
        }} /></div>
        {upload && <>
          <p>{upload.rows} data rows · {upload.file.name}</p>
          <details><summary>Map {label.toLowerCase()} columns</summary><div className="grid-form">{upload.fields.map(field => <Field key={field} label={`${label}: ${field}`} name={`mapping-${key}-${field}`} value={upload.mapping[field] || ''} empty="Do not import this field" options={upload.headers.map(header => ({ value: header, label: header }))} onChange={(e: any) => { invalidate(); const header = e.target.value; setUploads(current => ({ ...current, [key]: { ...current[key], mapping: { ...current[key].mapping, [field]: header }, saved: false } })) }} />)}</div>
          <Action run={() => saveMapping(key, upload)}>Save {label.toLowerCase()} mapping</Action>{upload.saved && <Chip tone="good">Mapping saved</Chip>}</details>
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => { setUploads(current => { const next = { ...current }; delete next[key]; return next }); const input = document.getElementById(`spreadsheet-${key}`) as HTMLInputElement; if (input) input.value = ''; invalidate() }}>Remove {label.toLowerCase()} file</button>
        </>}
      </Card>
    })}</div>
    <Card title="Bank balances (if your opening includes a bank account)">
      {banks.map((b, i) => <div key={i} className="grid-form line">{[['account', 'Account name'], ['institution', 'Bank'], ['last4', 'Last four digits'], ['statementBalance', 'Reconciled statement balance']].map(([field, label]) => <Field key={field} label={`${label} ${i + 1}`} name={`sheet-bank-${i}-${field}`} value={b[field as keyof typeof b]} onChange={(e: any) => { const value = e.target.value; setBanks(current => current.map((bank, j) => i === j ? { ...bank, [field]: value } : bank)); invalidate() }} />)}</div>)}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setBanks(current => [...current, blankBank()])}>Add spreadsheet bank account</button>
    </Card>
    <div className="row-actions"><button className="btn btn-primary" disabled={busy || !cutoverDate || Object.keys(uploads).length === 0 || !!pending || !!undoing} onClick={() => run(async () => {
      for (const [key, upload] of Object.entries(uploads)) await saveMapping(key, upload)
      const data = { source: 'spreadsheet', cutoverDate, files: Object.fromEntries(Object.entries(uploads).map(([key, u]) => [key, u.file])), banks: banks.filter(b => b.account) }
      setPkg(data); setPreview(await command('move-in.preview', data)); setRowPage(0); setRowFilter('all'); setLeaveOut(false)
    })}>{busy ? 'Checking…' : 'Preview spreadsheets'}</button>{progress && <span role="status">{progress}</span>}</div>
    {preview && <>
      <Card title="Spreadsheet dry run">
        <Table heads={['List', 'Ready', 'Refused']} figures={[1, 2]}>{Object.entries(preview.counts).map(([key, count]: [string, any]) => <tr key={key}><td>{LABELS[key] || key}</td><td>{count.accepted}</td><td>{count.refused}</td></tr>)}</Table>
      </Card>
      <Card title="Spreadsheet tie-outs" actions={<Chip tone={preview.checks.every((c: D) => c.ok) ? 'good' : 'bad'}>{preview.checks.every((c: D) => c.ok) ? 'All match' : 'Resolve differences'}</Chip>}>
        <Table heads={['Check', 'Result', 'Details']}>{preview.checks.map((c: D) => <tr key={c.key}><td>{c.title}</td><td>{c.ok ? 'Matches' : 'Differs'}</td><td>{c.detail}</td></tr>)}</Table>
        {preview.trialBalance.length > 0 && <details><summary>Opening trial balance</summary><Table heads={['Account', 'Debit', 'Credit']} figures={[1, 2]}>{preview.trialBalance.map((r: D, i: number) => <tr key={i}><td>{r.account}</td><td>{usd(r.debit)}</td><td>{usd(r.credit)}</td></tr>)}</Table></details>}
      </Card>
      <Card title={`Refused spreadsheet rows (${preview.refused.length})`}><Table heads={['File', 'Row', 'Reason']} empty="No refused rows.">{preview.refused.map((r: D, i: number) => <tr key={i}><td>{r.file}</td><td>{r.row || 'Opening total'}</td><td>{r.reason}</td></tr>)}</Table></Card>
      <Card title={`Every row (${preview.rows.length})`}>
        <Field label="Show spreadsheet rows" name="spreadsheet-row-filter" value={rowFilter} options={[{ value: 'all', label: 'All rows' }, { value: 'refused', label: 'Refused rows' }, { value: 'update', label: 'Updates' }]} onChange={(e: any) => { setRowFilter(e.target.value); setRowPage(0) }} />
        <Table heads={['File', 'Row', 'Result', 'Values / reason']} empty="No rows in this view.">{pageRows.map((r: D, i: number) => <tr key={i}><td>{r.file}</td><td>{r.row}</td><td><Chip tone={r.status === 'refused' ? 'bad' : r.status === 'update' ? 'info' : 'good'}>{r.status}</Chip></td><td>{r.reason && <p>{r.reason}</p>}<details><summary>View values</summary><dl>{(r.values.cells ? r.values.cells.map((cell: D) => [cell.column, cell.content]) : Object.entries(r.values).filter(([k]) => !k.startsWith('_'))).map(([key, value]: [string, any]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details></td></tr>)}</Table>
        <div className="row-actions"><button className="btn btn-secondary" disabled={rowPage === 0} onClick={() => setRowPage(p => p - 1)}>Previous rows</button><span>{rows.length ? rowPage * 25 + 1 : 0}–{Math.min(rows.length, (rowPage + 1) * 25)} of {rows.length}</span><button className="btn btn-secondary" disabled={(rowPage + 1) * 25 >= rows.length} onClick={() => setRowPage(p => p + 1)}>Next rows</button></div>
      </Card>
      <p className="hint">{preview.missingDocuments}</p>
      {preview.refused.length > 0 && <label className="check"><input type="checkbox" checked={leaveOut} onChange={e => setLeaveOut(e.target.checked)} /> Leave the {preview.refused.length} refused rows out of this import</label>}
      <div className="row-actions"><button className="btn btn-primary" disabled={busy || !preview.checks.every((c: D) => c.ok) || (preview.refused.length > 0 && !leaveOut) || !shared.state.actor.can.record} onClick={() => run(async () => { const result = await command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint, leaveRefusedOut: leaveOut }); await reload(); await resume(result.job) })}>Import spreadsheet records as staged</button></div>
    </>}
    {error && <p role="alert" className="error">{error}</p>}
  </>
}
