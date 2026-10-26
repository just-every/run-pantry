import { useState } from 'react'
import { Card, Chip, Field, Table, type D } from './kit'

/** Mount inside the owner or accountant's existing package or move-out screen. */
export function Portability({ initialYear = new Date().getFullYear()-1, endpoint = '/api/pantry/portability/export' }: { initialYear?: number; endpoint?: string }) {
  const [destination,setDestination] = useState('qbo'),[year,setYear] = useState(String(initialYear)),[busy,setBusy] = useState(false),[error,setError] = useState(''),[preview,setPreview] = useState<{ manifest:D;transport:D;query:string }|null>(null)
  async function review(event: React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');setPreview(null)
    const query = new URLSearchParams({destination,year,format:'json'}).toString()
    try {
      const response = await fetch(`${endpoint}?${query}`),body = await response.json() as D
      if (!response.ok) throw new Error(body.error || 'Destination export could not be prepared')
      setPreview({manifest:body.manifest,transport:body.transport,query:new URLSearchParams({destination,year,format:'zip'}).toString()})
    } catch(e) { setError(e instanceof Error ? e.message : 'Destination export could not be prepared') }
    finally { setBusy(false) }
  }
  const m = preview?.manifest
  return <div className="stack"><Card title="Move these books to QuickBooks Online or Xero"><p>Export a closed fiscal year with the chart, contacts, items, open invoices and bills, posted journals and original documents. The package includes the prior posted history needed to reproduce the closing trial balance.</p>
    <form onSubmit={review} className="stack">
      <Field label="Destination accounting system" name="destination" value={destination} options={[{value:'qbo',label:'QuickBooks Online'},{value:'xero',label:'Xero'}]} onChange={(e:any)=>{setDestination(e.target.value);setPreview(null)}}/>
      <Field label="Fiscal year ending in" name="year" type="number" value={year} required onChange={(e:any)=>{setYear(e.target.value);setPreview(null)}}/>
      <p className="hint">Every operating month in the selected fiscal year must be locked. Exporting does not send records to the destination.</p>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy?'Preparing export…':'Review destination export'}</button>
      {error&&<p role="alert">{error}</p>}
    </form></Card>
    {m&&<><Card title="Destination export review" actions={<a className="btn btn-primary" href={`${endpoint}?${preview!.query}`} download>Download destination package</a>}>
      <p>{m.entity.legalName} · {m.period.from} to {m.period.to} · {m.entity.currency} · Accrual basis</p>
      <Chip tone={m.blockers.length?'warn':'neutral'}>{m.blockers.length?`${m.blockers.length} issues to resolve`:'Destination mapping and verification required'}</Chip>
      <p>{m.counts.accounts} accounts, {m.counts.contacts} contacts, {m.counts.items} items, {m.counts.openInvoices} open invoices, {m.counts.openBills} open bills and {m.counts.documents} original documents.</p>
      <p>{m.ledgerCoverage.representedEntries} of {m.ledgerCoverage.postedEntries} posted entries have native destination request payloads. Every posted entry remains in the source archive.</p>
      <p className="hint">Read the manifest and import instructions before uploading files. Destination IDs, tax and account mappings must come from the actual destination. Verify its trial balance, open balances and uploaded originals after importing.</p>
      <a href={`${endpoint}?${new URLSearchParams({destination:m.destination,year:String(m.period.year),format:'json'})}`} download>Download manifest and native request plan</a>
    </Card>
    {m.blockers.length>0&&<Card title="Records needing attention"><Table heads={['Source record','Required resolution']} empty="No unsupported records.">{m.blockers.map((b:D,i:number)=><tr key={i}><td>{b.source}</td><td>{b.reason}</td></tr>)}</Table></Card>}
    <Card title="Destination mappings"><Table heads={['Source type','Destination selection']} empty="No additional mappings.">{m.mappings.map((mapping:D)=><tr key={mapping.key}><td>{mapping.key.split(':')[0]}</td><td>{mapping.reason}</td></tr>)}</Table></Card></>}
  </div>
}
