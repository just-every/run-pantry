import { useState } from 'react'
import { Action, Card, Chip, Field, Form, Loading, Table, accountOptions, amountText, command, contactOptions, day, today, usd, useShared, useView, type D } from './kit'

const FIELD_LABELS: Record<string, string> = { account: 'Account', number: 'Check number', date: 'Date', amount: 'Amount', payee: 'Payee', status: 'Issue/void', memo: 'Memo' }
const defaultColumns = ['account', 'number', 'date', 'amount', 'payee', 'status'].map(field => ({ field, header: FIELD_LABELS[field] }))

function Setup({ bankId, profile, reload }: { bankId: string; profile?: D; reload: () => Promise<void> }) {
  const format = profile?.positive_pay
  const [columns, setColumns] = useState<D[]>(format?.columns ?? defaultColumns)
  return <Card title="Check setup">
    <p>Use the next unused number on this bank’s stock. Enter the positive-pay mapping supplied by your bank, then print an alignment page on plain paper.</p>
    <Form label="Save check setup" className="grid-form" submit={b => command('check.settings', { ...b, bankAccountId: bankId, revision: profile?.revision,
      positivePay: { name: b.formatName, account: b.accountReference, columns, header: b.header === 'yes', delimiter: b.delimiter, dateFormat: b.dateFormat, amountFormat: b.amountFormat, issueCode: b.issueCode, voidCode: b.voidCode } })} onDone={reload}>
      <Field label="Next check number" name="nextNumber" type="number" min="1" max="999999998" defaultValue={profile?.next_number} required />
      <Field label="Check stock" name="stock" defaultValue={profile?.stock ?? 'voucher'} options={[{ value: 'voucher', label: 'Voucher: check + two stubs' }, { value: 'three-per-page', label: 'Three checks per page' }]} required />
      <Field label="Horizontal offset (mm)" name="offsetXmm" type="number" step="0.1" min="-20" max="20" defaultValue={profile?.offset_x_mm ?? 0} hint="Positive moves right." />
      <Field label="Vertical offset (mm)" name="offsetYmm" type="number" step="0.1" min="-20" max="20" defaultValue={profile?.offset_y_mm ?? 0} hint="Positive moves down." />
      <Field label="Bank format name" name="formatName" required defaultValue={format?.name} />
      <Field label="Bank-provided account identifier" name="accountReference" required defaultValue={format?.account} hint="Copy the identifier your bank expects in its positive-pay file." />
      <Field label="Heading row" name="header" defaultValue={format?.header === false ? 'no' : 'yes'} options={[{ value: 'yes', label: 'Include column headings' }, { value: 'no', label: 'No headings' }]} required />
      <Field label="Delimiter" name="delimiter" defaultValue={format?.delimiter ?? ','} options={[{ value: ',', label: 'Comma' }, { value: ';', label: 'Semicolon' }, { value: '\t', label: 'Tab' }]} required />
      <Field label="Date format" name="dateFormat" defaultValue={format?.dateFormat ?? 'MM/DD/YYYY'} options={['YYYY-MM-DD', 'MM/DD/YYYY', 'MMDDYYYY', 'YYYYMMDD'].map(value => ({ value, label: value }))} required />
      <Field label="Amount format" name="amountFormat" defaultValue={format?.amountFormat ?? 'decimal'} options={[{ value: 'decimal', label: 'Dollars and cents (1250.00)' }, { value: 'cents', label: 'Integer cents (125000)' }]} required />
      <Field label="Issue code" name="issueCode" required defaultValue={format?.issueCode} />
      <Field label="Void code" name="voidCode" required defaultValue={format?.voidCode} />
      <div className="field field-wide"><strong>Positive-pay columns, in bank order</strong><p className="hint">Check number, date, amount and issue/void status are required. Change headings and order to match the bank’s specification.</p>
        {columns.map((col, i) => <div className="grid-form" key={i}>
          <Field label={`Column ${i + 1} field`} name={`columnField${i}`} value={col.field} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setColumns(columns.map((c, j) => j === i ? { ...c, field: e.target.value } : c))} options={Object.entries(FIELD_LABELS).map(([value, label]) => ({ value, label }))} required />
          <Field label={`Column ${i + 1} heading`} name={`columnHeader${i}`} value={col.header} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColumns(columns.map((c, j) => j === i ? { ...c, header: e.target.value } : c))} required />
          <div className="form-end"><button type="button" className="btn btn-secondary" disabled={!i} onClick={() => { const next = [...columns]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setColumns(next) }}>Move up</button><button type="button" className="btn btn-secondary" onClick={() => setColumns(columns.filter((_, j) => j !== i))}>Remove</button></div>
        </div>)}
        <button type="button" className="btn btn-secondary" disabled={columns.length >= 7} onClick={() => { const field = Object.keys(FIELD_LABELS).find(f => !columns.some(c => c.field === f)); if (field) setColumns([...columns, { field, header: FIELD_LABELS[field] }]) }}>Add column</button>
      </div>
    </Form>
    {profile && <p><a className="btn btn-secondary" target="_blank" rel="noreferrer" href={`/api/pantry/checks/alignment/${bankId}`}>Print alignment page</a></p>}
  </Card>
}

function Write({ bankId, profile, bills, reload }: { bankId: string; profile: D; bills: D[]; reload: () => Promise<void> }) {
  const { state } = useShared(), [kind, setKind] = useState('bill'), [selected, setSelected] = useState<string[]>([])
  return <Card title="Write checks"><p>Next number: <strong>{profile.next_number}</strong>. Each selected bill gets its own check. Recording an expense creates and settles its bill in the same action.</p>
    <Form label="Issue checks" onDone={async () => { setSelected([]); await reload() }} className="grid-form" submit={b => command('check.issue', { bankAccountId: bankId, revision: profile.revision, date: b.date,
      items: kind === 'bill' ? bills.filter(bill => selected.includes(bill.id)).map(bill => ({ kind, contactId: bill.vendor_id, amount: amountText(bill.open_cents), memo: b.memo || bill.reference, allocations: [{ targetId: bill.id, amount: amountText(bill.open_cents) }] }))
        : [{ kind, contactId: b.contactId, amount: b.amount, accountId: b.accountId, description: b.description, memo: b.memo }] })}>
      <Field label="Write as" name="kind" value={kind} options={[{ value: 'bill', label: 'Bill payments' }, { value: 'expense', label: 'Expense' }]} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setKind(e.target.value)} />
      <Field label="Check date" name="date" type="date" required defaultValue={today()} />
      {kind === 'bill' ? <div className="field field-wide"><Table heads={['Pay', 'Bill', 'Vendor', 'Open']} figures={[3]} empty="No unpaid recorded bills.">
        {bills.map(b => <tr key={b.id}><td><input type="checkbox" aria-label={`Pay bill ${b.reference}`} checked={selected.includes(b.id)} onChange={e => setSelected(e.target.checked ? [...selected, b.id] : selected.filter(id => id !== b.id))} /></td><td>{b.reference}</td><td>{b.vendor_name}</td><td className="fig">{usd(b.open_cents)}</td></tr>)}
      </Table></div> : <>
        <Field label="Payee" name="contactId" options={contactOptions(state.contacts, 'vendor')} required />
        <Field label="Expense account" name="accountId" options={accountOptions(state.accounts, a => !['receivable', 'payable', 'bank'].includes(a.subtype) && ['expense', 'asset'].includes(a.type))} required />
        <Field label="Expense amount" name="amount" inputMode="decimal" required />
        <Field label="Expense description" name="description" required />
      </>}
      <Field label="Check memo" name="memo" wide />
    </Form>
  </Card>
}

function Batch({ batch, reload }: { batch: D; reload: () => Promise<void> }) {
  const { state } = useShared(), [voiding, setVoiding] = useState<D | null>(null), [download, setDownload] = useState('')
  return <Card title={`Checks ${batch.checks[0].number}–${batch.checks.at(-1).number}`} actions={<a className="btn btn-secondary" target="_blank" rel="noreferrer" href={`/api/pantry/checks/batches/${batch.id}/print`}>Print batch</a>}>
    <p>{day(batch.check_date)} · {batch.bank_name} · {batch.stock === 'voucher' ? 'Voucher stock' : 'Three per page'}</p>
    <Table heads={['Number', 'Payee / bills', 'Amount', 'Status', '']} figures={[2]}>{batch.checks.map((c: D) => <tr key={c.id}>
      <td>{c.number}</td><td>{c.payee}<small className="sub">{c.allocations.map((a: D) => a.reference).join(', ')}</small></td><td className="fig">{usd(c.amount_cents)}</td>
      <td>{c.status === 'void' ? <><Chip tone="bad">Void</Chip><small className="sub">{day(c.void_date)} · {c.void_reason}</small></> : <Chip tone={c.match_id ? 'good' : 'neutral'}>{c.match_id ? 'Cleared' : 'Issued'}</Chip>}</td>
      <td>{c.status === 'issued' && state.actor.can.post && <button type="button" className="btn btn-secondary" onClick={() => setVoiding(c)}>Void check {c.number}</button>}</td>
    </tr>)}</Table>
    {voiding && <Form label={`Confirm void ${voiding.number}`} className="grid-form" submit={b => command('check.void', { ...b, id: voiding.id })} onDone={async () => { setVoiding(null); await reload() }} secondary={<button type="button" className="btn btn-secondary" onClick={() => setVoiding(null)}>Cancel</button>}>
      <p className="field-wide">The number stays in this batch. Voiding reverses its payment and reopens the paid bills. Undo a cleared check’s bank match first.</p>
      <Field label="Void date" name="date" type="date" required defaultValue={today()} /><Field label="Void reason" name="reason" required />
    </Form>}
    {state.actor.can.record && <p><Action run={async () => { const file = await command('check.export-positive-pay', { batchId: batch.id }); setDownload(file.url); await reload() }}>Export positive-pay CSV</Action>{download && <> <a className="btn btn-secondary" href={download}>Download positive-pay CSV</a></>}</p>}
    {batch.exports.length > 0 && <details><summary>Positive-pay export history ({batch.exports.length})</summary><ul>{batch.exports.map((e: D) => <li key={e.id}>{day(e.created_at)} · {e.format.name}{state.actor.can.record && <> · <a href={`/api/pantry/checks/exports/${e.id}.csv`}>Download saved CSV</a></>}</li>)}</ul><p>Each saved file retains its batch state at export. After a void, export a fresh file for the bank.</p></details>}
  </Card>
}

export function Checks() {
  const view = useView<D>('checks'), shared = useShared(), [selectedBank, setSelectedBank] = useState('')
  const banks = shared.state.bankAccounts.filter((b: D) => shared.state.accounts.find((a: D) => a.id === b.account_id)?.type === 'asset')
  const bankId = selectedBank || banks[0]?.id, profile = view.data?.profiles.find((p: D) => p.bank_account_id === bankId)
  const reload = async () => { await Promise.all([view.reload(), shared.reload()]) }
  if (!view.data) return <Loading what="checks" error={view.error} />
  if (!bankId) return <Card title="Checks"><p>Add a checking account under Bank › Statements to write checks.</p></Card>
  return <div className="stack"><Card title="Checks"><p>Write bill payments and expenses, print on preprinted bank stock, and send a positive-pay file in your bank’s format.</p><Field label="Check bank account" name="checkBank" value={bankId} options={banks.map((b: D) => ({ value: b.id, label: `${b.name} · …${b.number_last4}` }))} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedBank(e.target.value)} /></Card>
    {shared.state.actor.can.record && <div className="split split-wide-left"><div className="stack">{profile ? <Write bankId={bankId} profile={profile} bills={view.data.bills} reload={reload} /> : <Card title="Write checks"><p>Complete check setup for this account first.</p></Card>}</div><div className="stack"><Setup key={`${bankId}:${profile?.revision}`} bankId={bankId} profile={profile} reload={reload} /></div></div>}
    {view.data.batches.filter((b: D) => b.bank_account_id === bankId).map((b: D) => <Batch key={b.id} batch={b} reload={reload} />)}
    {!view.data.batches.some((b: D) => b.bank_account_id === bankId) && <Card title="Check batches"><p>No checks issued from this account yet.</p></Card>}
  </div>
}
