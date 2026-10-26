import { DocumentArchives } from './document-archives'
// Move in from QuickBooks Online or Xero: upload the exports, preview counts,
// refusals, tie-outs and what will not come in, import as staged records, then
// the accountant signs off (posting the opening balances) or the import is
// undone. After a Xero import, its attachments can be carried over.
import { useEffect, useRef, useState } from 'react'
import { Action, Card, Chip, command, Details, Field, Loading, PageHead, Table, Tabs, day, useShared, useView, useWho, type D } from './kit'
import { Icon } from './icons'
import { COUNT_LABEL, SOURCES, sourceName, type SourceKey } from './move-in-sources'
import { MoveInSpreadsheets } from './move-in-spreadsheets'
import { XeroAttachments } from './move-in-xero'
import { Portability } from './portability'

type Bank = { account: string; institution: string; last4: string; statementBalance: string }
const moveInName = (key: string) => key === 'spreadsheet' ? 'Spreadsheet' : sourceName(key)
const countLabel = (key: string) => key === 'items' ? 'Items' : COUNT_LABEL[key]
const blank = (): Bank => ({ account: '', institution: '', last4: '', statementBalance: '' })

/** What came in (or will), and what did not, each with why. */
function Outcome({ counts, left }: { counts: D; left: D[] }) {
  return <div className="split even">
    <Card title="What came in">
      <Table heads={['Record', 'Count']} figures={[1]}>{Object.entries(counts).map(([k, v]) => <tr key={k}><td>{countLabel(k)}</td><td className="fig">{typeof v === 'number' ? v : v.accepted}</td></tr>)}</Table>
    </Card>
    <Card title="What did not come in, and why">
      <Table heads={['What', 'Count', 'Why']} figures={[1]} empty="Everything in the files comes in.">{left.map(l => <tr key={l.what}><td>{l.what}</td><td className="fig">{l.count || '—'}</td><td>{l.why}</td></tr>)}</Table>
    </Card>
  </div>
}

export function MoveIn() {
  const shared = useShared(), who = useWho(), status = useView<D>('move-in'), inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const [source, setSource] = useState<SourceKey | 'spreadsheet'>('quickbooks-online')
  const [banks, setBanks] = useState<Bank[]>([blank()])
  const [preview, setPreview] = useState<D | null>(null), [pkg, setPkg] = useState<D | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { if (status.data?.jobs.some((j: D) => j.source === 'spreadsheet' && ['queued', 'applying', 'failed', 'undoing'].includes(j.state))) setSource('spreadsheet') }, [status.data])
  const kit = SOURCES.find(s => s.key === source) ?? SOURCES[0]
  const read = async () => {
    const files: D = {}
    for (const [key, label] of kit.files) { const f = inputs.current[`${source}-${key}`]?.files?.[0]; if (!f) throw new Error(`Choose the ${label} export`); files[key] = { name: f.name, content: await f.text() } }
    return { source, files, banks: banks.filter(b => b.account) }
  }
  const run = async (f: () => Promise<void>) => { setBusy(true); setError(''); try { await f() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const refresh = async () => { await status.reload(); await shared.reload() }
  const staged = status.data?.cutovers.find((c: D) => c.status === 'staged'), accepted = status.data?.cutovers.find((c: D) => c.status === 'accepted')
  const cut = accepted ?? staged
  const job = status.data?.jobs.find((j: D) => j.state === 'completed')
  const report = job && status.data?.reports.find((r: D) => r.jobId === job.id)
  const bank = (i: number, key: keyof Bank) => (e: any) => setBanks(bs => bs.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x))
  return <>
    <PageHead title="Move in" lead="Bring your books from QuickBooks Online or Xero. Preview the exports before anything changes; imported records stay staged until someone signs off the trial balance, open items and bank balances." />
    {status.data && cut && <Card title={`Cutover from ${moveInName(cut.source)}`} actions={accepted ? <Chip tone="good">Signed off</Chip> : <Chip tone="warn">Waiting for sign-off</Chip>}>
      <p>{cut.summary}.</p>
      {accepted ? <p>Signed off by {who(accepted.accepted_by)} on {day(accepted.accepted_at)}. Corrections now go through reversing or adjusting entries; the import can no longer be undone.</p> : <>
        <p>The opening entry is a draft. Signing off checks again that open invoices equal receivables, unpaid bills equal payables and each bank balance equals its statement, then posts it.</p>
        <div className="row-actions">
          {shared.state.actor.can.post ? <Action tone="primary" run={async () => { await command('move-in.accept', { id: staged.id, revision: staged.revision }); await refresh() }}>Accountant sign-off</Action> : <span className="hint">Sign-off needs the posting grant.</span>}
          {job && shared.state.actor.can.post && <Action tone="danger" run={async () => { let result = await command('move-in.undo', { jobId: job.id }); while (result.job.state === 'undoing') result = await command('move-in.undo', { jobId: job.id }); setPreview(null); await refresh() }}>Undo import</Action>}
        </div></>}
      <p className="hint">{status.data.history} history lines kept read-only for reference.</p>
    </Card>}
    {status.data && cut && report && <Outcome counts={report.cameIn} left={report.leftOut} />}
    {status.data && cut?.source === 'xero' && <XeroAttachments xero={status.data.xero} reload={refresh} />}
    {!status.data ? <Loading error={status.error} what="move-in" /> : !cut && <Tabs tabs={[...SOURCES.map(s => s.name), 'Spreadsheet']} current={source === 'spreadsheet' ? 'Spreadsheet' : kit.name} onChange={name => { setSource(name === 'Spreadsheet' ? 'spreadsheet' : SOURCES.find(s => s.name === name)!.key); setPreview(null); setError('') }} />}
    {status.data && !accepted && (source === 'spreadsheet' || cut?.source === 'spreadsheet') && <MoveInSpreadsheets status={status.data} reload={refresh} />}
    {status.data && !cut && source !== 'spreadsheet' && <>
      <div className="split split-wide-left">
        <Card title={`1. ${kit.name} exports`}>
          <p className="hint">{kit.intro}</p>
          <div className="grid-form">{kit.files.map(([key, label, hint]) => <div className="field" key={`${source}-${key}`}><label htmlFor={`${source}-${key}`}>{label}</label><input id={`${source}-${key}`} type="file" accept=".csv" ref={el => { inputs.current[`${source}-${key}`] = el }} /><small className="hint">{hint}</small></div>)}</div>
        </Card>
        <Card title="2. Bank accounts at cutover">
          <p className="hint">For each bank account on the trial balance, enter the reconciled statement balance on the cutover date. It must equal the trial balance.</p>
          {banks.map((b, i) => <div className="grid-form line" key={i}>
            <Field label={kit.bankName} name={`b-account-${i}`} value={b.account} onChange={bank(i, 'account')} />
            <Field label="Bank" name={`b-inst-${i}`} value={b.institution} onChange={bank(i, 'institution')} />
            <Field label="Last four digits" name={`b-last4-${i}`} value={b.last4} inputMode="numeric" onChange={bank(i, 'last4')} />
            <Field label="Reconciled statement balance" name={`b-bal-${i}`} value={b.statementBalance} inputMode="decimal" onChange={bank(i, 'statementBalance')} />
          </div>)}
          <button type="button" className="btn btn-secondary" onClick={() => setBanks(bs => [...bs, blank()])}>Add bank account</button>
          <div className="form-end"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const p = await read(); setPkg(p); setPreview(await command('move-in.preview', p)) })}>{busy ? 'Checking…' : 'Preview (dry run)'}</button>{error && !preview && <p role="alert" className="error">{error}</p>}</div>
        </Card>
      </div>
    </>}
    {preview && !cut && <>
      <Card title={`Import summary — ${moveInName(preview.source)}, cutover ${preview.cutoverDate}`}>
        <div className="counts">{Object.entries(preview.counts).map(([k, v]: [string, any]) => <div key={k} className="count"><strong>{v.accepted}</strong><span>{countLabel(k)}</span>{v.refused ? <Chip tone="bad">{v.refused} refused</Chip> : <Chip tone="good">ready</Chip>}</div>)}</div>
      </Card>
      <div className="split even">
        <Card title="Tie-outs" actions={preview.checks.every((c: D) => c.ok) ? <Chip tone="good">All match</Chip> : <Chip tone="bad">Not yet</Chip>}>
          <Table heads={['Check', 'Result', 'Details']}>{preview.checks.map((c: D) => <tr key={c.key}><td>{c.title}</td><td>{c.ok ? <Chip tone="good">Matches</Chip> : <Chip tone="bad">Differs</Chip>}</td><td>{c.detail}</td></tr>)}</Table>
        </Card>
        <Card title={`Refused rows (${preview.refused.length})`}>
          <Table heads={['File', 'Row', 'Kind', 'Reason']} empty="No rows refused.">{preview.refused.map((r: D) => <tr key={r.file + r.row + r.kind}><td>{r.file}</td><td>{r.row}</td><td>{r.kind}</td><td>{r.reason}</td></tr>)}</Table>
        </Card>
      </div>
      <Card title="What will not come in, and why">
        <Table heads={['What', 'Count', 'Why']} figures={[1]} empty="Everything in the files comes in.">{preview.notImported.map((l: D) => <tr key={l.what}><td>{l.what}</td><td className="fig">{l.count || '—'}</td><td>{l.why}</td></tr>)}</Table>
      </Card>
      <div className="callout callout-warn"><Icon name="alert" /><div><strong>Missing source documents</strong><span>{preview.missingDocuments}</span></div></div>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !preview.checks.every((c: D) => c.ok) || preview.refused.length > 0 || !shared.state.actor.can.record} onClick={() => run(async () => { await command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint }); await refresh() })}>Import as staged records</button>
        <Details facts={{ fingerprint: preview.fingerprint, ...Object.fromEntries(Object.entries(preview.files).map(([k, f]: [string, any]) => [f.label, `${f.name}, ${f.bytes} bytes`])) }} code={['fingerprint']} />
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </>}
    {shared.state.actor.role === 'owner' && <DocumentArchives />}
    {['owner', 'accountant'].includes(shared.state.actor.role) && <details><summary>Export a closed year to another accounting system</summary><Portability /></details>}
    {status.data && status.data.jobs.length > 0 && <Card title="Import journal">
      <Table heads={['Import', 'From', 'State', 'Records', 'Error']} figures={[3]}>{status.data.jobs.map((j: D) => <tr key={j.id}><td><code>{j.id.slice(0, 8)}</code></td><td>{moveInName(j.source)}</td><td>{j.state === 'completed' ? <Chip tone="good">Imported</Chip> : j.state === 'undone' ? <Chip>Undone</Chip> : <Chip tone="warn">{j.state}</Chip>}</td><td className="fig">{j.checkpoint} of {j.total}</td><td>{j.error ?? '—'}</td></tr>)}</Table>
    </Card>}
  </>
}
