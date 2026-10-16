import { Chevron, Icon, Party } from './parts'
import { ReceiptPaper } from './Receipt'

// October's net income and the records it ties to, drawn as Pantry shows them: the Chase feed, the Home Depot
// receipt, the Stripe payout, INV-0231 and the accountant's sign-off. The tie-lines run between the cards.
export function HeroCards() {
  return <div className="hero-cards" role="img" aria-label="Net income for October, $11,040, tied to the Chase Business feed, a Home Depot receipt for $312.48, a Stripe payout of $4,812.30 matched to 23 charges, invoice INV-0231 paid by ACH and the accountant's sign-off">
    <div aria-hidden="true">
      <svg className="hero-ties" viewBox="0 0 652 459">
        <path d="M65 168V100q0-32 32-32M216 130v38M392 130v45M478 87h13q16 0 16 16v72M304 238v14M433 265v23" />
        {[[65, 166], [216, 132], [216, 166], [392, 132], [392, 173], [480, 87], [507, 173], [304, 240], [433, 267], [433, 286]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" />)}
      </svg>
      <div className="hc hc-net"><span className="hc-icon"><Icon name="bars" /></span><div><p className="hc-label">Net income · October</p><p className="hc-figure">$11,040</p></div></div>
      <div className="hc hc-row hc-bank"><Party tone="bank"><Icon name="bank" /></Party><div className="hc-text"><p className="hc-title">Chase Business ••4417</p><p className="hc-sub">2,847 transactions</p></div><p className="hc-amount good">$6,320.24</p><Chevron /></div>
      <div className="hc hc-receipt"><div className="hc-thumb"><ReceiptPaper mini /></div><div className="hc-text"><p className="hc-title">Home Depot receipt</p><p className="hc-big">$312.48</p>
        <dl className="hc-fields"><div><dt>Vendor</dt><dd>Home Depot</dd></div><div><dt>Date</dt><dd>Oct 13, 2026</dd></div><div><dt>Category</dt><dd>Tools &amp; Equipment</dd></div></dl></div></div>
      <div className="hc hc-row hc-stripe"><span className="wordmark-stripe">stripe</span><div className="hc-text"><p className="hc-title">Stripe</p><p className="hc-sub strong">+ $4,812.30 matched</p><p className="hc-sub">to 23 charges, $141.20 fees</p></div><Chevron /></div>
      <div className="hc hc-row hc-invoice"><Icon name="doc" className="hc-doc" /><div className="hc-text"><p className="hc-title">INV-0231 <span>Brightline Dental</span></p><p className="hc-line"><span className="hc-sub strong">$3,200 · Paid via ACH</span><span className="pill pill-green">Paid</span></p></div><Chevron /></div>
      <div className="hc hc-row hc-signoff"><span className="avatar">JK</span><div className="hc-text"><p className="hc-title">Looks right, closing October</p><p className="hc-sub">Reviewed by your accountant</p></div><Chevron /></div>
    </div>
  </div>
}
