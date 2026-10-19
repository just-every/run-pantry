// 1099 contractors: vendors marked for a 1099-NEC, their payments in a calendar
// year counted by the IRS rules Pantry can apply, the threshold flag, and in
// January the forms' figures and the filing CSV. Pantry files nothing itself.
import { AskAccountant } from './ask-accountant'
import { useState } from 'react'
import { Card, Chip, Field, Form, Loading, Metrics, Table, command, day, usd, useShared, useView, type D } from './kit'

const METHODS = [{ value: 'check', label: 'Check' }, { value: 'ach', label: 'ACH' }, { value: 'wire', label: 'Wire' }, { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card (on a 1099-K)' }, { value: 'payment-network', label: 'Payment network, e.g. PayPal (on a 1099-K)' }]
const METHOD: Record<string, string> = { unrecorded: 'Not recorded', check: 'Check', ach: 'ACH', wire: 'Wire', cash: 'Cash', card: 'Card', 'payment-network': 'Payment network' }

function status(c: D, threshold: number): [string, 'good' | 'warn' | 'bad' | 'neutral'] {
  if (c.overThreshold) return c.missing.length ? [`1099-NEC due · add ${c.missing.join(' and ')}`, 'bad'] : ['1099-NEC due', 'warn']
  if (c.mayReach) return ['Set payment methods', 'warn']
  return [`Under ${usd(threshold)}`, 'neutral']
}

function Details({ c, onDone }: { c: D; onDone: () => Promise<void> }) {
  const { state } = useShared(), t = c.tax
  return <Form key={c.id + (t?.tin ?? '')} label="Save 1099 details" submit={b => command('contractor.save', { ...b, contactId: c.id, is1099: b.is1099 === 'on' })} onDone={onDone} className="grid-form">
    <label className="check field-wide"><input type="checkbox" name="is1099" defaultChecked={c.is1099} /> Pays this vendor for services (gets a 1099-NEC)</label>
    <Field label="Legal name (as on the W-9)" name="legalName" defaultValue={t?.legalName ?? c.name} />
    <Field label="TIN type" name="tinKind" defaultValue={t?.tinKind ?? 'ssn'} options={[{ value: 'ssn', label: 'SSN or ITIN' }, { value: 'ein', label: 'EIN' }]} />
    <Field label="TIN" name="tin" autoComplete="off" inputMode="numeric" hint={t ? `On file: ${t.tin}. Leave blank to keep it.` : 'Nine digits from the W-9. Shown only as its last four.'} />
    <Field label="Street address" name="address" defaultValue={t?.address} />
    <Field label="City" name="city" defaultValue={t?.city} />
    <Field label="State" name="state" defaultValue={t?.state} options={state.settings.choices.states.map((s: string) => ({ value: s, label: s }))} />
    <Field label="ZIP code" name="zip" defaultValue={t?.zip} inputMode="numeric" />
  </Form>
}

function Payments({ c, onDone }: { c: D; onDone: () => Promise<void> }) {
  const { state } = useShared()
  return <Table heads={['Date', 'Reference', 'Paid by', 'Amount', 'In box 1']} figures={[3]} empty="No payments recorded in this year.">
    {c.payments.map((p: D) => <tr key={p.id} className={p.reversed ? 'muted' : ''}><td>{day(p.date)}</td><td className="nowrap">{p.reference || '—'}</td>
      <td>{p.method === 'unrecorded' && state.actor.can.record
        ? <select aria-label={`How the ${p.date} payment was made`} defaultValue="" onChange={async e => { if (e.target.value) { await command('payment.set-method', { id: p.id, method: e.target.value }); await onDone() } }}><option value="">Not recorded — choose…</option>{METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        : METHOD[p.method]}</td>
      <td className="fig">{usd(p.amount)}</td><td>{p.reversed ? 'Reversed' : p.counts ? 'Yes' : p.method === 'unrecorded' ? 'Not until the method is set' : 'No, reported on a 1099-K'}</td></tr>)}
  </Table>
}

export function Contractors({ year, onYear }: { year: number; onYear: (y: number) => void }) {
  const { state } = useShared(), { data: r, error, reload } = useView<D>(`reports/contractors?year=${year}`)
  const [selected, setSelected] = useState<string | null>(null), [adding, setAdding] = useState('')
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 4 }, (_, i) => thisYear - 2 + i).filter(y => y <= thisYear)
  const current = r?.contractors.find((c: D) => c.id === selected)
  return <>
    <div className="callout"><div><strong>Pantry does not file with the IRS.</strong><span>It keeps your contractors' payments and W-9 details, flags who needs a 1099-NEC and, after the year ends, gives you each form's figures and a CSV to file through the IRS or a filing service. Box 1 counts check, ACH, wire and cash payments; card and payment-network payments are left out because the processor reports them on Form 1099-K. Whether a vendor needs a 1099 at all (services, not goods; most corporations are exempt) is your and your accountant's call.</span></div></div>
    <div className="inline-fields year-pick"><div className="field inline"><label htmlFor="tax-year">Tax year</label><select id="tax-year" value={year} onChange={e => onYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></div></div>
    {!r ? <Loading error={error} what="1099 contractors" /> : <>
      <Metrics items={[{ label: 'Threshold', value: usd(r.threshold), note: r.thresholdNote }, { label: 'Contractors', value: String(r.contractors.length), note: 'marked for a 1099-NEC' }, { label: `At or over ${usd(r.threshold)}`, value: String(r.forms.length), note: r.yearEnded ? <>file by {day(r.dueBy)}</> : 'so far this year' }]} />
      <Card title={<>1099 contractors · {year} <Chip tone="info">Payment basis</Chip></>}>
          <Table heads={['Contractor', 'TIN', 'Box 1 (check, ACH, wire, cash)', 'Card and networks (left out)', 'Method not recorded', 'Status']} figures={[2, 3, 4]} empty="No vendor is marked as a 1099 contractor yet.">
            {r.contractors.map((c: D) => { const [label, tone] = status(c, r.threshold); return <tr key={c.id} tabIndex={0} className={selected === c.id ? 'selected' : ''} onClick={() => setSelected(c.id)} onKeyDown={k => { if (k.key === 'Enter') setSelected(c.id) }}>
              <td>{c.name}<AskAccountant subjectKind="report-line" subjectId={JSON.stringify({ report: 'contractors', line: c.id, from: `${year}-01-01`, to: `${year}-12-31`, basis: 'cash' })} label={`1099 contractor · ${c.name} · ${year}`} /></td><td className="nowrap">{c.tax?.tin ?? <Chip tone="warn">Missing</Chip>}</td><td className="fig">{usd(c.box1)}</td><td className="fig">{usd(c.excluded)}</td><td className="fig">{usd(c.unrecorded)}</td><td><Chip tone={tone}>{label}</Chip></td></tr> })}
          </Table>
          {r.unmarked.length > 0 && <p className="hint">Paid {usd(r.threshold)} or more by check, ACH, wire or cash but not marked as contractors: {r.unmarked.map((u: D) => `${u.name} (${usd(u.box1)})`).join(', ')}.</p>}
      </Card>
      <div className="split split-wide-left">
        <div className="stack">
          {current ? <Card title={current.name}><Payments c={current} onDone={reload} />{state.actor.can.record && <Details c={current} onDone={reload} />}</Card>
            : <Card title="Contractor"><p>Choose a contractor to see the year's payments and their W-9 details.</p></Card>}
        </div>
        <div className="stack">
          {state.actor.can.record && r.vendors.length > 0 && <Card title="Mark a vendor as a 1099 contractor">
            <Form label="Mark as 1099 contractor" submit={() => command('contractor.save', { contactId: adding, is1099: true })} onDone={async () => { setSelected(adding); setAdding(''); await reload() }}>
              <Field label="Vendor" name="vendor" value={adding} onChange={(e: any) => setAdding(e.target.value)} required options={r.vendors.map((v: D) => ({ value: v.id, label: v.name }))} />
            </Form></Card>}
        </div>
      </div>
      <Card title={`1099-NEC forms for ${year}`}>
        {!r.yearEnded ? <p>The {year} forms are ready after December 31, {year}. Until then the figures above are this year's payments so far.</p> : <>
          <p>Due to recipients and the IRS by {day(r.dueBy)}. Box 4 is $0.00: Pantry records no backup withholding.</p>
          <Table heads={['Recipient', 'TIN', 'Box 1 nonemployee compensation', 'Box 4 federal income tax withheld', 'Ready to file']} figures={[2, 3]} empty={`No contractor reached ${usd(r.threshold)} in ${year}.`}>
            {r.forms.map((f: D) => <tr key={f.id}><td>{f.name}</td><td className="nowrap">{f.tin ?? 'Missing'}</td><td className="fig">{usd(f.box1)}</td><td className="fig">{usd(f.box4)}</td><td>{f.ready ? <Chip tone="good">Ready</Chip> : <Chip tone="bad">Add TIN and address</Chip>}</td></tr>)}
          </Table>
          {r.forms.length > 0 && (state.actor.can.post ? <p><a className="btn btn-primary" href={`/api/pantry/reports/contractors/${year}/1099-nec.csv`} download>Download the {year} 1099-NEC CSV</a> <small className="sub">It carries full TINs; every download is in the activity log.</small></p>
            : <p className="hint">The filing CSV carries full TINs, so the owner or someone with the posting grant downloads it.</p>)}
        </>}
      </Card>
    </>}
  </>
}
