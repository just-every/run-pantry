import { ACTIVITY, AGING, INVOICE } from '../book'
import { Check, Dots, HeadSection } from '../parts'

/** Oct 4–19: INV-0231 sent with its pay link, viewed, reminded, paid by ACH bank transfer and matched to the Chase
 * deposit; the recurring INV-0240 beside it and receivables aging. */
const tallest = Math.max(...AGING.map(([, , n]) => n))

export function Invoices() {
  return <HeadSection id="invoices" className="invoices" eyebrow="Oct 4–19 · Invoices" title="Sent. Reminded. Paid. Matched."
    body="Email the invoice with a card or ACH link. Reminders go out on schedule, and the payment matches itself."
    label={`Invoice ${INVOICE.number} to ${INVOICE.customer}, ${INVOICE.due.toLowerCase()}, ${INVOICE.paid.toLowerCase()}: ${INVOICE.lines.map(([w, a]) => `${w} ${a}`).join(', ')}, total ${INVOICE.total}, paid by ACH. Activity: ${ACTIVITY.map(([w, t]) => `${w}, ${t}`).join('; ')}. Recurring INV-0240, Brightline Dental, $450 a month, next Nov 1. Receivables aging: ${AGING.map(([b, a]) => `${b} ${a}`).join(', ')}.`}>
    <div className="inv-grid">
      <div className="card inv">
        <p className="inv-head"><b>{INVOICE.number}</b><span className="chip chip-green">{INVOICE.paid}</span></p>
        <p className="inv-customer">{INVOICE.customer}</p>
        <p className="inv-due">{INVOICE.due}</p>
        <div className="inv-lines">{INVOICE.lines.map(([what, amount]) => <p key={what}><span>{what}</span><span>{amount}</span></p>)}</div>
        <p className="inv-total"><b>Total</b><b>{INVOICE.total}</b></p>
        <p className="inv-paid"><Check />Paid by ACH · {INVOICE.total}</p>
      </div>
      <div className="card activity">
        <p className="card-title">Activity</p>
        <ol>{ACTIVITY.map(([what, when, done]) => <li key={what} className={done ? 'done' : ''}><span className="act-node" /><b>{what}</b><span>{when}</span></li>)}</ol>
      </div>
      <div className="inv-side">
        <div className="card recurring"><p className="card-title">Recurring · INV-0240</p><p><Dots text="Brightline Dental · $450 / month · next Nov 1" /></p></div>
        <div className="card aging">
          <p className="card-title">Receivables aging</p>
          <div className="aging-bars">{AGING.map(([bucket, amount, n], i) =>
            <div key={bucket} className={`aging-bar b${i}`}><span className="bar" style={{ height: n ? `${(n / tallest) * 100}%` : undefined }} /><span className="aging-bucket">{bucket}</span><b>{amount}</b></div>)}</div>
        </div>
      </div>
    </div>
  </HeadSection>
}
