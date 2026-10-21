// Agent work, documents and the activity record.
import { useRef } from 'react'
import { Action, Card, Chip, command, Details, Empty, Field, FileLink, Form, Loading, PageHead, Table, day, readFileBase64, usd, useShared, useView, useWho, type D } from './kit'
import { Icon } from './icons'
import { ProposalApproval } from './proposals'

const KIND: Record<string, string> = { match: 'Bank match', journal: 'Journal entry', 'close-packet': 'Close packet', 'variance-note': 'Variance explanation' }

function ProposalBody({ p, accounts }: { p: D; accounts: D[] }) {
  const name = (id: string) => { const a = accounts.find(x => x.id === id); return a ? `${a.code} · ${a.name}` : id }
  if (p.kind === 'journal') return <>
    <Table heads={['Account', 'Debit', 'Credit']} figures={[1, 2]}>{p.payload.lines.map((l: D, i: number) => <tr key={i}><td>{name(l.accountId)}</td><td className="fig">{l.debit ? usd(Math.round(Number(l.debit) * 100)) : ''}</td><td className="fig">{l.credit ? usd(Math.round(Number(l.credit) * 100)) : ''}</td></tr>)}</Table>
    <blockquote className="evidence">{p.payload.passages.map((x: string, i: number) => <p key={i}>“{x}”</p>)}<footer>Quoted from the cited document. <a href={`/api/pantry/documents/${p.payload.documentId}`}>Open document</a></footer></blockquote>
  </>
  if (p.kind === 'close-packet') return <ul>{p.payload.exceptions.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
  if (p.kind === 'variance-note') return <><p>{p.payload.body}</p><p className="hint">Explanation only: it cites {p.payload.citations.length} posted entries and changes no figure.</p></>
  return <p className="hint">{p.payload.bankLineIds.length} statement line(s) to {(p.payload.journalLineIds ?? []).length} posting(s). Review it on the statement in Bank.</p>
}

export function Agents() {
  const { data, error, reload } = useView<D>('proposals'), shared = useShared(), who = useWho()
  if (!data) return <Loading error={error} what="agent work" />
  const waiting = data.proposals.filter((p: D) => p.status === 'proposed'), decided = data.proposals.filter((p: D) => p.status !== 'proposed')
  return <>
    <PageHead title="Agent work" lead="Your agent prepares; a person approves. Approval re-checks every record the agent cited, the period lock and your role." />
    {!waiting.length && <Card title="Nothing waiting" className="empty-card"><Empty><p>No proposals are waiting. {shared.state.actor.can.owner ? 'Create an agent token in People & settings, then follow Agent work in the Pantry docs.' : ''}</p></Empty></Card>}
    {waiting.map((p: D) => <Card key={p.id} title={<><Icon name="agent" /> {KIND[p.kind]} from {p.agent_name}</>} actions={<Chip tone="agent">Proposed</Chip>}>
      <p><strong>{p.summary}</strong></p>
      <ProposalBody p={p} accounts={shared.state.accounts} />
      <ProposalApproval p={p} canApprove={shared.state.actor.can.record} onDone={async()=>{await reload();await shared.reload()}} />
      <Details facts={{ id: p.id, filed: p.created_at, cited: p.refs.map((r: D) => `${r.kind}:${r.id}`).join(', ') }} />
    </Card>)}
    {decided.length > 0 && <Card title="Decided"><Table heads={['Filed', 'Kind', 'Summary', 'Decision', 'By']}>
      {decided.map((p: D) => <tr key={p.id}><td>{day(p.created_at)}</td><td>{KIND[p.kind]}</td><td>{p.summary}</td><td>{p.status === 'approved' ? <Chip tone="good">Approved</Chip> : p.status === 'stale' ? <Chip tone="warn">Stale</Chip> : <Chip>Rejected</Chip>}</td><td>{who(p.decided_by)}</td></tr>)}
    </Table></Card>}
  </>
}

export function Documents() {
  const { data, error, reload } = useView<D>('documents'), shared = useShared(), who = useWho(), file = useRef<HTMLInputElement>(null)
  return <>
    <PageHead title="Documents" lead="Receipts, vendor invoices and statements, kept exactly as uploaded." />
    {shared.state.actor.can.record && <Card title="Upload a document"><Form label="Upload" submit={async b => command('document.upload', { ...(await readFileBase64(file.current)), note: b.note })} onDone={reload} className="grid-form">
      <div className="field"><label htmlFor="doc-file">File</label><input id="doc-file" ref={file} type="file" required /></div><Field label="Note" name="note" />
    </Form></Card>}
    {!data ? <Loading error={error} what="documents" /> : <Card title="All documents"><Table heads={['Name', 'Attached to', 'Size', 'Uploaded', '']} figures={[2]} empty="No documents yet.">
      {data.documents.map((d: D) => <tr key={d.id}><td><FileLink id={d.id} name={d.name} mediaType={d.media_type} /></td><td>{d.linked_label ?? 'Nothing yet'}{d.duplicate_of && <small className="sub block"><Chip tone="warn">{d.duplicate_decision === 'skip' ? 'Duplicate skipped' : d.duplicate_decision === 'keep' ? 'Kept both' : 'Duplicate'}</Chip> <a href={`/api/pantry/documents/${d.duplicate_of}`}>Original</a>{!d.duplicate_decision && <> · <a href={`/app/receipts#document-${d.id}`}>Review duplicate</a></>}{d.duplicate_reason && <> · {d.duplicate_reason}</>}</small>}</td><td className="fig">{Math.ceil(d.size / 1024)} KB</td><td>{who(d.uploaded_by)}, {day(d.uploaded_at)}</td><td><a href={`/api/pantry/documents/${d.id}`}>Download</a><Details facts={{ 'Fingerprint (SHA-256)': d.sha256 }} code={['Fingerprint (SHA-256)']} /></td></tr>)}
    </Table></Card>}
  </>
}
