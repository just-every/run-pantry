import { accountOptions, Card, Field, useShared, type D } from './kit'

export const paymentMethods = [{ value: 'check', label: 'Check' }, { value: 'ach', label: 'ACH' }, { value: 'wire', label: 'Wire' }, { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'payment-network', label: 'Payment network' }]

export function mayRecordDeposits(state: D) {
  return state.actor.role === 'owner' || (['bookkeeper', 'accountant'].includes(state.actor.role) && state.actor.can.post)
}

/** The native invoice inputs are kept in entered order, including chosen line numbers. */
export function EstimateEconomics({ discounts, setDiscounts, deposit, setDeposit, early, setEarly }: {
  discounts: D[]; setDiscounts: (next: D[]) => void; deposit: D | null; setDeposit: (next: D | null) => void; early: D | null; setEarly: (next: D | null) => void
}) {
  const { state } = useShared()
  const change = (i: number, patch: D) => setDiscounts(discounts.map((d, n) => n === i ? { ...d, ...patch } : d))
  return <>
    <Card title="Discounts" actions={discounts.length < 5 && <button type="button" className="btn btn-secondary" onClick={() => setDiscounts([...discounts, { type: 'percent', value: '', lines: null, afterTax: false }])}>Add discount</button>}>
      <p className="hint">Applied in the order shown. Subtotal discounts cover item lines only. Chosen lines can include delivery. Choose after tax only when the business uses that treatment.</p>
      {discounts.map((d, i) => <fieldset key={i}><legend>Discount {i + 1}</legend><div className="grid-form">
        <Field label={`Discount ${i + 1} type`} name={`discount-type-${i}`} value={d.type} onChange={(e: any) => change(i, { type: e.target.value })} required options={[{ value: 'percent', label: 'Percentage' }, { value: 'amount', label: 'Amount' }]} />
        <Field label={`Discount ${i + 1} value`} name={`discount-value-${i}`} value={d.value} onChange={(e: any) => change(i, { value: e.target.value })} inputMode="decimal" required />
        <Field label={`Discount ${i + 1} applies to`} name={`discount-scope-${i}`} value={d.lines === null || d.lines === undefined ? 'subtotal' : 'lines'} options={[{ value: 'subtotal', label: 'Item subtotal' }, { value: 'lines', label: 'Chosen lines' }]} onChange={(e: any) => change(i, { lines: e.target.value === 'subtotal' ? null : [] })} />
        {Array.isArray(d.lines) && <Field label={`Discount ${i + 1} line numbers`} name={`discount-lines-${i}`} value={d.lines.join(', ')} onChange={(e: any) => change(i, { lines: e.target.value.split(',').map((n: string) => n.trim()) })} hint="Comma-separated line numbers, in the order shown above; delivery lines follow item lines." required />}
        <label className="check"><input type="checkbox" checked={!!d.afterTax} onChange={e => change(i, { afterTax: e.target.checked })} /> Apply discount {i + 1} after tax</label>
      </div><button type="button" className="btn btn-link" onClick={() => setDiscounts(discounts.filter((_, n) => n !== i))}>Remove discount {i + 1}</button></fieldset>)}
      {!discounts.length && <p>No discounts.</p>}
    </Card>
    <Card title="Deposit received at invoice issue">
      <p className="hint">This term carries to the converted invoice and records a payment when it is issued. Money already received before work starts belongs in Customer deposits.</p>
      {mayRecordDeposits(state) ? <>
        <label className="check"><input type="checkbox" checked={!!deposit} onChange={e => setDeposit(e.target.checked ? { amount: '', method: 'ach', date: '', bankAccountId: '', reference: '' } : null)} /> Include a deposit at issue</label>
        {deposit && <div className="grid-form">
          <Field label="Deposit at issue amount" name="depositIssueAmount" inputMode="decimal" value={deposit.amount} onChange={(e: any) => setDeposit({ ...deposit, amount: e.target.value })} required />
          <Field label="Deposit at issue date" name="depositIssueDate" type="date" value={deposit.date} onChange={(e: any) => setDeposit({ ...deposit, date: e.target.value })} required />
          <Field label="Deposit at issue method" name="depositIssueMethod" options={paymentMethods} value={deposit.method} onChange={(e: any) => setDeposit({ ...deposit, method: e.target.value })} required />
          <Field label="Deposit-to bank account" name="depositIssueBank" options={state.bankAccounts.map((b: D) => ({ value: b.id, label: b.name }))} value={deposit.bankAccountId} onChange={(e: any) => setDeposit({ ...deposit, bankAccountId: e.target.value })} required />
          <Field label="Deposit at issue reference" name="depositIssueReference" value={deposit.reference ?? ''} onChange={(e: any) => setDeposit({ ...deposit, reference: e.target.value })} />
        </div>}
      </> : <p className="hint">Recording a deposit requires financial posting access.{deposit ? ' This estimate already carries a deposit term; a person with that access must review any change.' : ''}</p>}
    </Card>
    <Card title="Early-payment term">
      <label className="check"><input type="checkbox" checked={!!early} onChange={e => setEarly(e.target.checked ? { percent: '', days: '' } : null)} /> Include early-payment terms</label>
      {early && <div className="grid-form"><Field label="Early-payment percentage" name="earlyPercent" inputMode="decimal" required value={early.percent} onChange={(e: any) => setEarly({ ...early, percent: e.target.value })} /><Field label="Days after invoice issue" name="earlyDays" type="number" min={1} required value={early.days} onChange={(e: any) => setEarly({ ...early, days: e.target.value })} /></div>}
      <p className="hint">Shown as text on the estimate. The offer and its payment deadline are calculated on the converted invoice and covered by its approval.</p>
    </Card>
  </>
}

export function EstimateDeliveryLines({ lines, setLines, itemCount }: { lines: D[]; setLines: (next: D[]) => void; itemCount: number }) {
  const { state } = useShared(), accounts = accountOptions(state.accounts, a => a.type === 'income')
  const change = (i: number, patch: D) => setLines(lines.map((l, n) => n === i ? { ...l, ...patch } : l))
  return <Card title="Delivery charges" actions={<button type="button" className="btn btn-secondary" onClick={() => setLines([...lines, { kind: 'delivery', description: '', quantity: '1', rate: '', accountId: accounts[0]?.value ?? '', taxCode: '' }])}>Add delivery charge</button>}>
    {lines.map((l, i) => <fieldset key={i}><legend>Line {itemCount + i + 1} · Delivery</legend><div className="grid-form">
      <Field label={`Delivery ${i + 1} description`} name={`delivery-description-${i}`} value={l.description} onChange={(e: any) => change(i, { description: e.target.value })} required />
      <Field label={`Delivery ${i + 1} quantity`} name={`delivery-quantity-${i}`} value={l.quantity} onChange={(e: any) => change(i, { quantity: e.target.value })} inputMode="decimal" required />
      <Field label={`Delivery ${i + 1} rate`} name={`delivery-rate-${i}`} value={l.rate} onChange={(e: any) => change(i, { rate: e.target.value })} inputMode="decimal" required />
      <Field label={`Delivery ${i + 1} income account`} name={`delivery-account-${i}`} value={l.accountId} onChange={(e: any) => change(i, { accountId: e.target.value })} options={accounts} required />
      <Field label={`Delivery ${i + 1} tax code`} name={`delivery-tax-${i}`} value={l.taxCode} onChange={(e: any) => change(i, { taxCode: e.target.value })} options={[{ value: 'exempt', label: 'Exempt / not taxable' }, ...state.taxCodes.map((t: D) => ({ value: t.id, label: t.name }))]} empty="Tax treatment needed" />
    </div><button type="button" className="btn btn-link" onClick={() => setLines(lines.filter((_, n) => n !== i))}>Remove delivery charge {i + 1}</button></fieldset>)}
    {!lines.length && <p>No delivery charges.</p>}
  </Card>
}
