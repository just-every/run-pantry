import { useState } from 'react'
import { Card, Chip, command, Field, Form, Loading, Table, Tabs, usd, useShared, useView, type D } from './kit'
import { CustomReportEditor } from './custom-report-editor'
import { Sharing } from './report-layout-editor'
import { CustomReportDrill } from './custom-report-drill'

export function CustomReportPreview({ report }: { report: D }) {
  const [figure, setFigure] = useState('')
  const value = (row: D, column: D) => {
    const amount = row.values[column.id]
    if (amount === null) return 'undefined'
    if (typeof amount !== 'number') return amount ?? ''
    const unit = row.kind === 'formula' && !['share', 'percent'].includes(column.id) ? row.unit : column.unit
    return unit === 'money' ? usd(amount) : unit === 'percent' ? `${amount.toFixed(2)}%` : `${amount.toFixed(2)} ratio`
  }
  return <><Card title={<>{report.name} <Chip tone="info">{report.basisLabel}</Chip></>}>
    <p>{report.range} · <a href={`/app/reports?${new URLSearchParams({ report: report.source, from: report.from, to: report.to, basis: report.basis })}`}>Open source report</a></p>
    <Table heads={report.columns.map((c: D) => c.label)} figures={report.columns.map((c: D, i: number) => c.unit === 'text' ? -1 : i).filter((i: number) => i >= 0)}>
      {report.rows.map((r: D) => r.kind === 'note' ? <tr key={r.id}><td colSpan={report.columns.length}>{r.text}</td></tr> : <tr key={r.id} className={r.kind === 'section' || r.kind === 'formula' ? 'total' : ''}>{report.columns.map((c: D) => <td key={c.id} className={c.unit === 'text' ? '' : 'fig'}>{c.unit === 'text' ? value(r, c) : <button className="btn btn-link" type="button" aria-label={`Open ${r.name} ${c.label}`} onClick={() => setFigure(`custom-reports/${encodeURIComponent(report.id)}/figures?${new URLSearchParams({ row: r.id, column: c.id })}`)}>{value(r, c)}</button>}</td>)}</tr>)}
    </Table>
    {report.notes.map((note: string, i: number) => <p className="hint" key={i}>{note}</p>)}
  </Card>{figure && <CustomReportDrill key={figure} path={figure} onClose={() => setFigure('')} />}</>
}

function SavedReport({ id, onEdit }: { id: string; onEdit: (saved: D) => void }) {
  const { data, error } = useView<D>(`custom-reports/${id}/render`)
  if (!data) return <Loading error={error} what="saved report" />
  return <div className="stack"><div className="row-actions">
    {data.saved.can_edit && <button type="button" className="btn btn-secondary" onClick={() => onEdit(data.saved)}>Edit custom report</button>}
    <a className="btn btn-primary" href={`/api/pantry/custom-reports/${id}/export.pdf`} download>Download custom report PDF · {data.report.basis}</a>
    <a className="btn btn-secondary" href={`/api/pantry/custom-reports/${id}/export.json`} download>Export report definition</a>
  </div><CustomReportPreview report={data.report} /></div>
}

function PackageEditor({ saved, reports, onDone, onCancel }: { saved?: D; reports: D[]; onDone: (saved: D) => Promise<void>; onCancel: () => void }) {
  const [ids, setIds] = useState<string[]>(saved?.reportIds ?? []), [roles, setRoles] = useState<string[]>(saved?.shared_roles ?? [])
  const move = (index: number, delta: number) => { const copy = [...ids], next = index + delta; [copy[index], copy[next]] = [copy[next], copy[index]]; setIds(copy) }
  return <Card title={saved ? `Edit ${saved.name}` : 'New management package'}>
    <Form label="Save management package" submit={b => command('management-package.save', { ...b, id: saved?.id, revision: saved?.revision, reportIds: ids, sharedRoles: roles })} onDone={onDone} secondary={<button className="btn btn-secondary" type="button" onClick={onCancel}>Cancel</button>}>
      <Field label="Package name" name="name" defaultValue={saved?.name} required />
      <Field label="Cover text" name="cover" type="textarea" defaultValue={saved?.cover} />
      <fieldset className="allocations"><legend>Reports in this package</legend>
        {reports.map(r => <label className="check" key={r.id}><input type="checkbox" aria-label={`Include ${r.name}`} checked={ids.includes(r.id)} onChange={e => setIds(e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))} />{r.name}</label>)}
        <ol>{ids.map((id, i) => <li key={id}>{reports.find(r => r.id === id)?.name ?? 'Unavailable report'} <button className="btn btn-link" type="button" disabled={i === 0} onClick={() => move(i, -1)}>Move report {i + 1} up</button><button className="btn btn-link" type="button" disabled={i === ids.length - 1} onClick={() => move(i, 1)}>Move report {i + 1} down</button></li>)}</ol>
      </fieldset>
      <Field label="Commentary" name="commentary" type="textarea" defaultValue={(saved?.commentary ?? []).join('\n')} />
      <Sharing roles={roles} setRoles={setRoles} />
    </Form>
  </Card>
}

function SavedPackage({ id, onEdit }: { id: string; onEdit: (saved: D) => void }) {
  const { data, error } = useView<D>(`management-packages/${id}/render`)
  if (!data) return <Loading error={error} what="management package" />
  return <div className="stack"><Card title={data.saved.name} actions={<>
    {data.saved.can_edit && <button className="btn btn-secondary" type="button" onClick={() => onEdit(data.saved)}>Edit management package</button>}
    <a className="btn btn-primary" href={`/api/pantry/management-packages/${id}/export.pdf`} download>Download management package PDF</a>
    <a className="btn btn-secondary" href={`/api/pantry/management-packages/${id}/export.json`} download>Export package definition</a>
  </>}><p>{data.saved.cover}</p>{data.saved.commentary.map((p: string, i: number) => <p key={i}>{p}</p>)}</Card>
    {data.reports.map((r: D) => <CustomReportPreview key={r.saved.id} report={r.report} />)}
  </div>
}

export function CustomReports() {
  const { state } = useShared(), { data, error, reload } = useView<D>('custom-reports'), packages = useView<D>('management-packages')
  const [tab, setTab] = useState('Saved reports'), [selected, setSelected] = useState(''), [editing, setEditing] = useState<D | null>(null)
  const packageTab = tab === 'Management packages'
  if (!data || !packages.data) return <Loading error={error || packages.error} what="custom reports" />
  const done = async (saved: D) => { await reload(); await packages.reload(); setEditing(null); setSelected(saved.id) }
  if (editing) return packageTab ? <PackageEditor saved={editing.id ? editing : undefined} reports={data.reports} onDone={done} onCancel={() => setEditing(null)} /> : <CustomReportEditor saved={editing.id ? editing : undefined} onDone={done} onCancel={() => setEditing(null)} />
  const rows = packageTab ? packages.data.packages : data.reports
  return <div className="stack">
    <p className="hint">Personal reports and packages are visible to you and the owner. The owner can view and edit all definitions. Sharing gives the chosen roles read and export access, with their own current financial permissions.</p>
    <Tabs tabs={['Saved reports', 'Management packages']} current={tab} onChange={t => { setTab(t); setSelected('') }} pick="Custom report view" />
    <Card title={tab} actions={state.actor.can.record && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>{packageTab ? 'New management package' : 'New custom report'}</button>}>
      <Table heads={['Name', 'Shared with', 'Actions']} empty={packageTab ? 'No management packages yet.' : 'No saved reports yet.'}>
        {rows.map((r: D) => <tr key={r.id}><td>{r.name}</td><td>{r.shared_roles.length ? r.shared_roles.join(', ') : 'Personal · owner access'}</td><td><button className="btn btn-link" type="button" onClick={() => setSelected(r.id)}>Open {r.name}</button></td></tr>)}
      </Table>
    </Card>
    {selected && (packageTab ? <SavedPackage key={selected} id={selected} onEdit={setEditing} /> : <SavedReport key={selected} id={selected} onEdit={setEditing} />)}
  </div>
}
