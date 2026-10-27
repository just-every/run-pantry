// CLOSE-004: the daily checks, what each flag cites, the rule and setting behind it, dismissing it with a reason, and the owner's settings.
import { useState } from 'react'
import { Card, Chip, command, Field, Form, Table, day, usd, useShared, useView, type D } from './kit'

const SETTINGS: [string, string, string][] = [
  ['unreconciledDays', 'Days after a statement before an account is unreconciled', '45'],
  ['staleQueueDays', 'Days a line may wait in the review queue', '7'],
  ['duplicateDays', 'Days apart for a likely duplicate payment', '7'],
  ['unusualMinPostings', 'Postings a vendor needs before amounts are judged', '4'],
  ['unusualRatio', 'Multiple of the median that is unusual', '3'],
  ['suspenseDays', 'Days a suspense balance may stand', '7'],
  ['clearingDays', 'Days a clearing difference may stand', '3'],
  ['lookbackDays', 'Days of recent activity judged for duplicates and unusual amounts', '60'],
]

function Settings({ settings, onDone }: { settings: D; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  if (!open) return <p><button type="button" className="btn btn-link" onClick={() => setOpen(true)}>Change the rules’ defaults</button></p>
  return <Form label="Save settings" submit={b => command('continuous-check.settings', { ...b, revision: settings.revision })} onDone={async () => { setOpen(false); await onDone() }} className="grid-form">
    {SETTINGS.map(([name, label]) => <Field key={name} label={label} name={name} type="number" step="any" defaultValue={settings.values[name]} required />)}
    <Field label="Least difference from the median (US$)" name="unusualMinDifference" defaultValue={(settings.values.unusualMinDifferenceCents / 100).toFixed(2)} required />
  </Form>
}

export function ContinuousChecks() {
  const shared = useShared(), can = shared.state.actor.can, { data, error, reload } = useView<D>('continuous-checks')
  const [dismissing, setDismissing] = useState<string | null>(null)
  if (!data) return error ? <Card title="Continuous checks"><p role="alert" className="error">{error}</p></Card> : null
  const open = data.flags.filter((f: D) => f.status === 'open'), dismissed = data.flags.filter((f: D) => f.status === 'dismissed')
  return <Card title="Continuous checks" actions={open.length ? <Chip tone="warn">{open.length} flagged</Chip> : <Chip tone="good">Nothing flagged</Chip>}>
    <p className="hint">Pantry runs these every day, not only at close{data.settings.lastRunOn && <>; last run {day(data.settings.lastRunOn)}</>}. Each flag cites its lines and the rule and setting that raised it, and stays dismissed until its lines change.</p>
    <Table heads={['Check', 'Flag', 'Lines', 'Rule and setting', '']} empty="No check is flagged.">
      {open.map((f: D) => <tr key={f.id}><td><strong>{f.ruleTitle}</strong><small className="sub">since {day(f.firstFlaggedOn)}</small></td><td>{f.title}<small className="sub">{f.detail}</small></td>
        <td><ul className="plain">{f.lines.map((l: D) => <li key={`${l.kind}:${l.id}`}>{l.label}{l.date ? ` · ${day(l.date)}` : ''}{l.amountCents != null ? ` · ${usd(l.amountCents)}` : ''}</li>)}</ul></td>
        <td><small className="sub">{data.rules.find((r: D) => r.rule === f.rule)?.title}: {Object.keys(f.setting).length ? Object.entries(f.setting).map(([k, v]) => `${k} ${k.endsWith('Cents') ? usd(v as number) : v}`).join(', ') : 'no setting'}</small></td>
        <td>{can.record && (dismissing === f.id
          ? <Form label="Dismiss" submit={b => command('continuous-check.dismiss', { id: f.id, revision: f.revision, ...b })} onDone={async () => { setDismissing(null); await reload() }} className="inline-form"><Field label="Why dismiss" name="reason" required /></Form>
          : <button type="button" className="btn btn-link" onClick={() => setDismissing(f.id)}>Dismiss with a reason</button>)}</td></tr>)}
    </Table>
    {dismissed.length > 0 && <p className="hint">Dismissed until their lines change: {dismissed.map((f: D) => `${f.title} (${f.dismissedReason}, ${f.dismissedBy})`).join('; ')}.</p>}
    {can.record && <p><button type="button" className="btn btn-link" onClick={async () => { await command('continuous-check.run', {}); await reload() }}>Run the checks now</button></p>}
    {shared.state.actor.role === 'owner' && <Settings settings={data.settings} onDone={reload} />}
  </Card>
}
