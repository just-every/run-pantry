// Attachments carried over from Xero after a Xero move-in: connect Xero
// (read-only), then carry the files on each imported open invoice and bill
// over in batches, showing what was kept and what could not be.
import { SetupSteps } from './provider-guides'
import { useEffect, useState } from 'react'
import { Action, Card, Chip, command, Table, day, useShared, useWho, type D } from './kit'

const size = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`
const pause = (seconds: number) => new Promise(r => setTimeout(r, seconds * 1000))

export function XeroAttachments({ xero, reload }: { xero: D; reload: () => Promise<void> }) {
  const who = useWho(), owner = useShared().state.actor.can.owner
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null), [status, setStatus] = useState('')
  const [organization, setOrganization] = useState('')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('xero') === 'connected') setNotice({ tone: 'good', text: 'Xero is connected. Carry the attachments over below.' })
    else if (q.get('xero_error')) setNotice({ tone: 'bad', text: q.get('xero_error')! })
  }, [])
  const carry = async () => {
    let view: D = await command('move-in.xero.carry', {})
    while (!view.done) {
      setStatus(view.wait ? `Xero asked Pantry to wait ${view.wait} seconds…` : `Checked ${view.checked} of ${view.items} records; ${view.carried} files kept so far…`)
      if (view.wait) await pause(view.wait)
      view = await command('move-in.xero.carry', {})
    }
    setStatus(''); await reload()
  }
  const chip = !xero.available ? <Chip>Not available here</Chip> : !xero.connection ? <Chip tone="warn">Not connected</Chip> : xero.done ? <Chip tone="good">Carried over</Chip> : <Chip tone="info">Connected</Chip>
  return <Card title="Attachments from Xero" actions={chip}>
    {notice && <p role={notice.tone === 'bad' ? 'alert' : 'status'} className={notice.tone === 'bad' ? 'error' : 'hint'}>{notice.text}</p>}
    {!xero.available ? xero.needsKeys ? <SetupSteps provider="xero" reason={xero.reason} summary="Set up a Xero app for attachments" owner={owner} /> : <p>{xero.reason}</p> : xero.choices?.length > 0 ? <>
      <fieldset className="choices provider-choices"><legend>Xero organization</legend>{xero.choices.map((org: D) => <label key={org.id} className={`choice${organization === org.id ? ' picked' : ''}`}><input type="radio" name="xero-organization" value={org.id} checked={organization === org.id} onChange={() => setOrganization(org.id)} /><strong>{org.tenantName}</strong></label>)}</fieldset>
      <div className="row-actions"><Action tone="primary" disabled={!xero.choices.some((org: D) => org.id === organization)} run={async () => { await command('move-in.xero.choose', { connectionId: organization }); await reload(); setNotice({ tone: 'good', text: 'Xero is connected. Carry the attachments over below.' }) }}>Connect Xero</Action></div>
    </> : !xero.connection ? <>
      <p>Xero’s exports carry no files. Connect Xero to bring over the files attached to the {xero.items} open invoices and bills you imported. Pantry asks Xero only to read invoices and their attachments.</p>
      <div className="row-actions"><Action tone="primary" run={async () => { const { url } = await command('move-in.xero.connect', {}); window.location.assign(url) }}>Connect Xero</Action></div>
    </> : <>
      <p>Connected to <strong>{xero.connection.tenantName}</strong> by {who(xero.connection.connectedBy)} on {day(xero.connection.connectedAt)}. {xero.done ? `All ${xero.items} imported records were checked in Xero.` : `${xero.checked} of ${xero.items} imported records checked so far.`}</p>
      {status && <p role="status" className="hint">{status}</p>}
      <div className="row-actions">
        {!xero.done && <Action tone="primary" run={carry}>Carry attachments over</Action>}
        <Action run={async () => { await command('move-in.xero.disconnect', {}); await reload() }}>Disconnect Xero</Action>
      </div>
    </>}
    {xero.files.length > 0 && <Table heads={['File', 'Record', 'Size', 'Result']} figures={[2]} caption="Files on the imported records">{xero.files.map((f: D) => <tr key={f.id}>
      <td>{f.status === 'carried' ? <a href={`/api/pantry/documents/${f.document_id}`}>{f.file_name}</a> : f.file_name}</td>
      <td>{f.item_kind === 'invoice' ? 'Invoice' : 'Bill'} {f.number}</td>
      <td className="fig">{size(f.size)}</td>
      <td>{f.status === 'carried' ? <Chip tone="good">Kept in Pantry</Chip> : f.status === 'too-large' ? <><Chip tone="warn">Not carried</Chip> <span className="hint">Over Pantry’s 1.5 MB limit for one document; keep it from Xero.</span></> : <Chip>Waiting</Chip>}</td>
    </tr>)}</Table>}
    {xero.notFound.length > 0 && <p className="hint">Not found in Xero by their number, so nothing was carried for them: {xero.notFound.map((x: D) => `${x.kind === 'invoice' ? 'invoice' : 'bill'} ${x.number}`).join(', ')}. Upload their files in Documents.</p>}
    {xero.done && xero.files.length === 0 && <p className="hint">None of the imported records has attachments in Xero.</p>}
  </Card>
}
