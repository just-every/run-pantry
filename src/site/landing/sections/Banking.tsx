import { Feature, Icon, Party, Tick } from '../parts'
import { ReceiptPaper } from '../Receipt'

function FeedCard() {
  return <div className="stack">
    <div className="card feed">
      <div className="feed-head"><Party tone="bank"><Icon name="bank" /></Party><p>Chase Business ••4417</p><span className="dots">•••</span></div>
      <div className="feed-row"><span className="date">Oct 14</span><span className="who">Adobe</span><span className="amt">−$59.99</span><span className="feed-note"><span className="pill pill-green">Software</span> by rule</span></div>
      <div className="feed-row"><span className="date">Oct 14</span><span className="who">Stripe payout</span><span className="amt good">+$4,812.30</span><span className="feed-note">matched to 23 charges</span></div>
      <div className="feed-row"><span className="date">Oct 13</span><span className="who">Home Depot</span><span className="amt">−$312.48</span><span className="feed-note"><span className="feed-thumb"><ReceiptPaper mini /></span>receipt attached</span></div>
    </div>
    <p className="nudge"><b>Amex ••1009</b> · re-link to stay current.</p>
  </div>
}

function ReceiptCard() {
  return <div className="card receipt-card">
    <div className="receipt-desk"><ReceiptPaper marks /></div>
    <svg className="receipt-leads" viewBox="0 0 556 476"><path d="M124 126 70 388M322 166 434 388" /><circle cx="70" cy="388" r="3.5" /><circle cx="434" cy="388" r="3.5" /></svg>
    <div className="receipt-match"><Party tone="depot">HD</Party><span className="who">Home Depot</span><span className="amt">−$312.48</span><span className="date">Oct 13</span><Tick /></div>
  </div>
}

export function BankFeeds() {
  return <Feature id="bank-feeds" eyebrow="Live bank feeds" title={<>Your bank,<br />already in.</>} art={<FeedCard />}
    label="Chase Business ••4417: Adobe −$59.99 on Oct 14 filed as Software by a rule, a Stripe payout of +$4,812.30 matched to 23 charges, and Home Depot −$312.48 on Oct 13 with its receipt attached. Amex ••1009 needs re-linking to stay current.">
    Connect your bank and cards once. Transactions arrive on their own, and your rules file the routine ones.
  </Feature>
}

export function Receipts() {
  return <Feature id="receipts" flip eyebrow="Receipts" title={<>Snap it. Forward it.<br />Done.</>} art={<ReceiptCard />}
    label="A Home Depot receipt with the vendor, the date 10/13/26 and the $312.48 total marked, attached to the Home Depot card charge of −$312.48 on Oct 13.">
    Take a photo or forward the email. Pantry reads the vendor, date and total, and attaches it to the right transaction.
  </Feature>
}
