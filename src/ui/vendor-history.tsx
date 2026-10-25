import { VendorW9 } from './w9'
import { useState } from 'react'
import type { VendorHistoryData } from '../pantry/vendor-history'
import { Action, Card, Chip, FileLink, Loading, Metrics, Table, day, usd, useShared, useView, useWho, type D } from './kit'

const KIND: Record<string, string> = { bill: 'Bill', payment: 'Payment', 'vendor-credit': 'Vendor credit', 'captured-draft': 'Captured draft' }
const METHOD: Record<string, string> = { unrecorded: 'Method not recorded', ach: 'ACH', check: 'Check', wire: 'Wire', cash: 'Cash', card: 'Card', 'payment-network': 'Payment network' }

function HistoryDetails({ row }: { row: D }) {
  const { state } = useShared(), who = useWho()
  return <details className="details"><summary>Documents, coding and activity</summary>
    {row.memo && <p>{row.memo}</p>}
    {row.method && <p>{METHOD[row.method] ?? row.method}{row.card_last4 ? ` · card ••${row.card_last4}` : ''}{row.bank_name ? ` · ${row.bank_name}` : ''}</p>}
    {row.class_name && <p>Class: {row.class_name}</p>}
    {row.tax_cents !== undefined && <p>Purchase tax: {usd(row.tax_cents)}</p>}
    {row.prepared_by && <p>Prepared by {who(row.prepared_by)}; {row.approved_by ? `approved by ${who(row.approved_by)}` : 'approval pending'}.</p>}
    {row.updated_at && <p>Last edited {day(row.updated_at)}</p>}
    <p>{row.documents.length ? row.documents.map((d: D) => <span className="filed" key={d.id}><FileLink id={d.id} name={d.name} mediaType={d.media_type} /></span>) : row.evidence_waived ? `Source unavailable: ${row.evidence_waived}` : 'No source document attached.'}</p>
    <Table heads={['Coding', 'Description', 'Amount']} figures={[2]} empty="No coding lines recorded.">
      {row.coding.map((l: D, i: number) => {
        const account = state.accounts.find((a: D) => a.id === l.account_id)
        return <tr key={l.id ?? i}><td>{l.account_code ?? account?.code} · {l.account_name ?? account?.name}</td><td>{l.description ?? l.memo}</td><td className="fig">{l.amount_cents !== undefined ? usd(l.amount_cents) : <>{l.debit_cents ? `${usd(l.debit_cents)} debit` : `${usd(l.credit_cents)} credit`}</>}</td></tr>
      })}
    </Table>
    {row.allocations.length > 0 && <Table heads={['Applied', 'Record', 'Amount', 'Balance treatment']} figures={[2]}>
      {row.allocations.map((a: D) => {
        const source = row.kind === 'bill', kind = source ? a.source_kind === 'credit' ? 'entry' : 'payment' : 'bill'
        const id = source ? a.source_kind === 'credit' ? a.source_journal_id : a.source_id : a.target_id
        return <tr key={a.id}><td>{day(a.allocation_date)}</td><td><a href={`/app/reports?record=${encodeURIComponent(`${kind}:${id}`)}`}>{source ? `${a.source_kind === 'credit' ? 'Credit' : 'Payment'} ${a.source_reference || ''}` : `Bill ${a.bill_reference}`}</a></td><td className="fig">{usd(a.amount_cents)}</td><td>{a.included_in_balance ? 'Included' : a.exclusion_reason}</td></tr>
      })}
    </Table>}
    {row.activity.length > 0 && <Table heads={['When', 'Activity', 'By']}>
      {row.activity.map((a: D) => <tr key={a.id}><td>{day(a.at)}</td><td>{a.action.split('.').join(' · ').replaceAll('-', ' ')}</td><td>{who(a.actor_email)}</td></tr>)}
    </Table>}
    {row.record_href && <p><a href={row.record_href}>Open linked record</a></p>}
    {row.capture_href && <p><a href={row.capture_href}>Open captured document</a></p>}
    {row.reversal_href && <p><a href={row.reversal_href}>Open reversal</a></p>}
  </details>
}

/** The same full vendor context can sit beside a manual bill or captured draft. */
export function VendorHistory({ vendorId }: { vendorId: string }) {
  const year = new Date().getUTCFullYear(), [from, setFrom] = useState(`${year}-01-01`), [to, setTo] = useState(`${year}-12-31`)
  const { data, error, reload } = useView<VendorHistoryData>(vendorId ? `vendors/${encodeURIComponent(vendorId)}/history?${new URLSearchParams({from,to})}` : null)
  const picker = <div className="inline-fields"><label>Spend from <input aria-label="Spend from" type="date" value={from} onChange={e=>{if(e.target.value)setFrom(e.target.value)}} /></label><label>Spend to <input aria-label="Spend to" type="date" value={to} onChange={e=>{if(e.target.value)setTo(e.target.value)}} /></label></div>
  if (!vendorId) return null
  if (!data) return <Card title="Vendor history">{picker}<Loading error={error} what="vendor history" /></Card>
  const s = data.summary
  return <Card title={`${data.vendor.name} · vendor history`} actions={<Action run={reload}>Refresh</Action>}>
    <VendorW9 id={vendorId} />
    {error && <p role="alert" className="error">{error}</p>}
    <p>{data.vendor.terms_days} day terms · Default account: {data.vendor.account_code ? `${data.vendor.account_code} · ${data.vendor.account_name}` : 'Not set'} · Class: {data.vendor.default_class || 'Unassigned'}</p>
    <p>1099 eligible: {data.vendor.is_1099 ? 'Yes' : 'No'} · Box: {data.vendor.vendor_tax_box} · TIN: {data.vendor.tin || 'Not on file'} · Backup withholding: {data.vendor.backup_withholding ? 'Flagged for review' : 'Not flagged'}</p>
    <p>Preferred payment: {METHOD[data.vendor.provider_payment_method] || 'Not recorded'}{data.vendor.payment_provider ? ` at ${data.vendor.payment_provider}` : ''}. This records a preference; it does not change the provider.</p>
    <p>{data.vendor.email} {data.vendor.phone}</p>
    {data.vendor.contacts.map((c: D, i: number) => <p key={i}>{c.name} · {c.email} · {c.phone}</p>)}
    {picker}
    <p>Expenses in period (accrual): {usd(data.spend.expense_cents)}. Includes all posted expense lines attributed to this vendor, including journals and dated reversals.</p>
    <p>Purchases in period: {usd(data.spend.net_purchases_cents)}. Bills {usd(data.spend.billed_cents)} less credits {usd(data.spend.credited_cents)}, plus captured expenses {usd(data.spend.captured_expense_cents)}. Payments in period: {usd(data.spend.paid_cents)}.</p>
    <p className="hint">Uses each record's date and current posted state; excludes drafts, voids and reversals. Payments are shown separately from purchases. Current payable below covers all dates.</p>
    <Metrics items={[
      { label: 'Bills recorded', value: usd(s.billed_cents) },
      { label: 'Payments recorded', value: usd(s.paid_cents) },
      { label: 'Net payable', value: usd(s.net_payable_cents) },
    ]} />
    <p>Open bills {usd(s.open_bill_cents)}; credits {usd(s.credited_cents)}; unallocated payments {usd(s.unallocated_payment_cents)} and credits {usd(s.unallocated_credit_cents)}. {s.pending_draft_count} pending captured drafts ({usd(s.pending_draft_cents)}); captured expenses posted {usd(s.posted_captured_expense_cents)}.</p>
    <p className="hint">All vendor records are included. Current balances exclude drafts, void bills and reversed records. Net payable is open bills less unallocated payments and credits. Captured bills appear with their source draft and count once in bill totals; posted captured expenses are shown separately.</p>
    <Table heads={['Date', 'Record', 'Status', 'Total', 'Current balance', 'Evidence and history']} figures={[3, 4]} empty="No activity for this vendor yet.">
      {data.rows.map(r => <tr key={`${r.kind}:${r.id}`}>
        <td>{day(r.date)}{r.due_date && <small className="sub">Due {day(r.due_date)}</small>}</td>
        <td><a href={r.href}>{KIND[r.kind]}{r.kind === 'captured-draft' ? ` · ${r.draft_kind}` : ''}{r.reference ? ` ${r.reference}` : ''}</a></td>
        <td><Chip tone={r.status === 'Void' || r.status === 'Reversed' || r.status === 'Needs review' ? 'warn' : r.included_in_balance ? 'info' : 'neutral'}>{r.status}</Chip><small className="sub">{r.status_reason}</small></td>
        <td className="fig">{usd(r.total_cents)}</td>
        <td className="fig">{usd(r.balance_cents)}{r.balance_cents !== null && <small className="sub">{r.balance_label}</small>}</td>
        <td><HistoryDetails row={r} /></td>
      </tr>)}
    </Table>
  </Card>
}
