// Move in from QuickBooks Online: upload the seven report exports, preview
// counts, refusals and tie-outs, import as staged records, then the accountant
// signs off (posting the opening balances) or the import is undone.
import { useRef, useState } from 'react'
import { Action, Card, Chip, command, Details, Field, Loading, PageHead, Table, day, useShared, useView, useWho, type D } from './kit'
import { Icon } from './icons'

const FILES: [string, string, string][] = [
  ['accounts', 'Account List', 'Reports → Account List'],
  ['customers', 'Customer Contact List', 'Reports → Customer Contact List'],
  ['vendors', 'Vendor Contact List', 'Reports → Vendor Contact List'],
  ['trialBalance', 'Trial Balance', 'As of the cutover date, accountant-approved'],
  ['openInvoices', 'Open Invoices', 'As of the cutover date'],
  ['unpaidBills', 'Unpaid Bills', 'As of the cutover date'],
  ['generalLedger', 'General Ledger', 'The history you want kept read-only'],
]
const COUNT_LABEL: Record<string, string> = { accounts: 'Accounts', customers: 'Customers', vendors: 'Vendors', bankAccounts: 'Bank accounts', trialBalance: 'Trial balance rows', openInvoices: 'Open invoices', unpaidBills: 'Unpaid bills', historyLines: 'History lines' }

type Bank = { account: string; institution: string; last4: string; statementBalance: string }

export function MoveIn() {
  const shared = useShared(), who = useWho(), status = useView<D>('move-in'), inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const [banks, setBanks] = useState<Bank[]>([{ account: '', institution: '', last4: '', statementBalance: '' }])
  const [preview, setPreview] = useState<D | null>(null), [pkg, setPkg] = useState<D | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const read = async () => {
    const files: D = {}
    for (const [key, label] of FILES) { const f = inputs.current[key]?.files?.[0]; if (!f) throw new Error(`Choose the ${label} export`); files[key] = { name: f.name, content: await f.text() } }
    return { files, banks: banks.filter(b => b.account) }
  }
  const run = async (f: () => Promise<void>) => { setBusy(true); setError(''); try { await f() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const refresh = async () => { await status.reload(); await shared.reload() }
  const staged = status.data?.cutovers.find((c: D) => c.status === 'staged'), accepted = status.data?.cutovers.find((c: D) => c.status === 'accepted')
  const job = status.data?.jobs.find((j: D) => j.state === 'completed')
  return <>
    <PageHead title="Move in from QuickBooks Online" lead="Preview your QuickBooks Online exports before anything changes. Imported records stay staged until someone signs off the trial balance, open items and bank balances." />
    {status.data && (staged || accepted) && <Card title="Cutover" actions={accepted ? <Chip tone="good">Signed off</Chip> : <Chip tone="warn">Waiting for sign-off</Chip>}>
      <p>{(accepted ?? staged).summary}.</p>
      {accepted ? <p>Signed off by {who(accepted.accepted_by)} on {day(accepted.accepted_at)}. Corrections now go through reversing or adjusting entries; the import can no longer be undone.</p> : <>
        <p>The opening entry is a draft. Signing off checks again that open invoices equal receivables, unpaid bills equal payables and each bank balance equals its statement, then posts it.</p>
        <div className="row-actions">
          {shared.state.actor.can.post ? <Action tone="primary" run={async () => { await command('move-in.accept', { id: staged.id, revision: staged.revision }); await refresh() }}>Accountant sign-off</Action> : <span className="hint">Sign-off needs the posting grant.</span>}
          {job && shared.state.actor.can.post && <Action tone="danger" run={async () => { await command('move-in.undo', { jobId: job.id }); setPreview(null); await refresh() }}>Undo import</Action>}
        </div></>}
      <p className="hint">{status.data.history} history lines kept read-only for reference.</p>
    </Card>}
    {!status.data ? <Loading error={status.error} what="move-in" /> : !staged && !accepted && <div className="split split-wide-left">
      <Card title="1. Export files">
        <p className="hint">Run each report in QuickBooks Online for the cutover date, export it unchanged and save it as CSV. Attachments export separately; upload source documents in Documents afterwards.</p>
        <div className="grid-form">{FILES.map(([key, label, hint]) => <div className="field" key={key}><label htmlFor={`qbo-${key}`}>{label}</label><input id={`qbo-${key}`} type="file" accept=".csv" ref={el => { inputs.current[key] = el }} /><small className="hint">{hint}</small></div>)}</div>
      </Card>
      <Card title="2. Bank accounts at cutover">
        <p className="hint">For each Bank account on the trial balance, enter the reconciled statement balance on the cutover date. It must equal the trial balance.</p>
        {banks.map((b, i) => <div className="grid-form line" key={i}>
          <Field label="QuickBooks account name" name={`b-account-${i}`} value={b.account} onChange={(e: any) => setBanks(bs => bs.map((x, j) => j === i ? { ...x, account: e.target.value } : x))} />
          <Field label="Bank" name={`b-inst-${i}`} value={b.institution} onChange={(e: any) => setBanks(bs => bs.map((x, j) => j === i ? { ...x, institution: e.target.value } : x))} />
          <Field label="Last four digits" name={`b-last4-${i}`} value={b.last4} inputMode="numeric" onChange={(e: any) => setBanks(bs => bs.map((x, j) => j === i ? { ...x, last4: e.target.value } : x))} />
          <Field label="Reconciled statement balance" name={`b-bal-${i}`} value={b.statementBalance} inputMode="decimal" onChange={(e: any) => setBanks(bs => bs.map((x, j) => j === i ? { ...x, statementBalance: e.target.value } : x))} />
        </div>)}
        <button type="button" className="btn btn-secondary" onClick={() => setBanks(bs => [...bs, { account: '', institution: '', last4: '', statementBalance: '' }])}>Add bank account</button>
        <div className="form-end"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const p = await read(); setPkg(p); setPreview(await command('move-in.preview', p)) })}>{busy ? 'Checking…' : 'Preview (dry run)'}</button>{error && <p role="alert" className="error">{error}</p>}</div>
      </Card>
    </div>}
    {preview && !staged && !accepted && <>
      <Card title={`Import summary — cutover ${preview.cutoverDate}`}>
        <div className="counts">{Object.entries(preview.counts).map(([k, v]: [string, any]) => <div key={k} className="count"><strong>{v.accepted}</strong><span>{COUNT_LABEL[k]}</span>{v.refused ? <Chip tone="bad">{v.refused} refused</Chip> : <Chip tone="good">ready</Chip>}</div>)}</div>
      </Card>
      <div className="split even">
        <Card title="Tie-outs" actions={preview.checks.every((c: D) => c.ok) ? <Chip tone="good">All match</Chip> : <Chip tone="bad">Not yet</Chip>}>
          <Table heads={['Check', 'Result', 'Details']}>{preview.checks.map((c: D) => <tr key={c.key}><td>{c.title}</td><td>{c.ok ? <Chip tone="good">Matches</Chip> : <Chip tone="bad">Differs</Chip>}</td><td>{c.detail}</td></tr>)}</Table>
        </Card>
        <Card title={`Refused rows (${preview.refused.length})`}>
          <Table heads={['File', 'Row', 'Kind', 'Reason']} empty="No rows refused.">{preview.refused.map((r: D) => <tr key={r.file + r.row + r.kind}><td>{r.file}</td><td>{r.row}</td><td>{r.kind}</td><td>{r.reason}</td></tr>)}</Table>
        </Card>
      </div>
      <div className="callout callout-warn"><Icon name="alert" /><div><strong>Missing source documents</strong><span>{preview.missingDocuments}</span></div></div>
      <div className="row-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !preview.checks.every((c: D) => c.ok) || preview.refused.length > 0 || !shared.state.actor.can.record} onClick={() => run(async () => { await command('move-in.commit', { ...pkg, fingerprint: preview.fingerprint }); await refresh() })}>Import as staged records</button>
        <Details facts={{ fingerprint: preview.fingerprint, ...Object.fromEntries(Object.entries(preview.files).map(([k, f]: [string, any]) => [f.label, `${f.name}, ${f.bytes} bytes`])) }} />
      </div>
    </>}
    {status.data && status.data.jobs.length > 0 && <Card title="Import journal">
      <Table heads={['Import', 'State', 'Records', 'Error']} figures={[2]}>{status.data.jobs.map((j: D) => <tr key={j.id}><td><code>{j.id.slice(0, 8)}</code></td><td>{j.state === 'completed' ? <Chip tone="good">Imported</Chip> : j.state === 'undone' ? <Chip>Undone</Chip> : <Chip tone="warn">{j.state}</Chip>}</td><td className="fig">{j.checkpoint} of {j.total}</td><td>{j.error ?? '—'}</td></tr>)}</Table>
    </Card>}
  </>
}
