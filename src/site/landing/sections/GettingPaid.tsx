import { Feature, Icon, Tick } from '../parts'

const STEPS: [string, string, boolean][] = [['Sent', 'Oct 14', false], ['Viewed', 'Oct 16', false], ['Reminder', 'Oct 21', false], ['Paid by ACH', 'Oct 23', true], ['Matched', '', true]]

function InvoiceCard() {
  return <div className="card invoice">
    <div className="invoice-head"><p>INV-0231 · Brightline Dental · $3,200.00</p><span className="pill pill-apricot">Repeats monthly</span></div>
    <ol className="timeline">{STEPS.map(([what, when, done], i) => <li key={what} className={done ? 'done' : ''}><span className={`node${i === STEPS.length - 1 ? ' last' : ''}`} /><span className="what">{what}{!when && <Tick />}</span>{when && <span className="when">{when}</span>}</li>)}</ol>
  </div>
}

function NumbersCard() {
  return <div className="stack numbers">
    <div className="card pl">
      <div className="pl-head"><p>October 2026</p><span className="toggle"><span className="on">Cash</span><span>Accrual</span></span></div>
      <div className="pl-row"><span>Revenue</span><span>$24,893</span></div>
      <div className="pl-row hot"><span>Contractors</span><span>$6,210</span><span className="pl-pin" /></div>
    </div>
    <div className="card behind"><span className="behind-icon"><Icon name="doc" /></span><p>Acme Contractors · 1099 · $3,150 · <span>3 bills</span></p></div>
  </div>
}

export function Invoices() {
  return <Feature id="invoices" eyebrow="Invoices" title={<>Invoices<br />that get paid.</>} art={<InvoiceCard />}
    label="Invoice INV-0231 to Brightline Dental for $3,200.00, repeating monthly: sent Oct 14, viewed Oct 16, reminder Oct 21, paid by ACH Oct 23, and matched.">
    Send it and Pantry follows up. Customers pay by card or ACH from the link, and the payment matches itself.
  </Feature>
}

export function Numbers() {
  return <Feature id="numbers" flip eyebrow="Every number, explained" title={<>Click any<br />number.</>} art={<NumbersCard />}
    label="October 2026 profit and loss on a cash basis: revenue $24,893; the contractors line, $6,210, opens to Acme Contractors, a 1099 vendor with $3,150 across 3 bills.">
    Every figure on your P&amp;L opens to the bills, receipts and transactions behind it. Cash or accrual, one switch.
  </Feature>
}
