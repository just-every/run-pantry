import { Check, Feature, Icon, Party, Tick } from '../parts'

function ConnectedCards() {
  return <div className="connected">
    <div className="card conn conn-stripe"><Party tone="stripe">S</Party><div><p className="conn-title">Stripe payout · $4,812.30</p><p className="conn-sub">= sales $4,953.50 − fees $141.20</p></div></div>
    <div className="card conn conn-gusto"><Party tone="gusto">g</Party><div><p className="conn-title">Gusto payroll <span>· Oct 15</span></p><p className="conn-figure">$4,206.50 <span className="pill pill-green">balanced <Tick /></span></p></div></div>
    <div className="card conn conn-tax"><span className="conn-doc"><Icon name="doc" /></span><div><p className="conn-title">Sales tax</p><dl className="rates"><div><dt>California</dt><dd>7.25%</dd></div><div><dt>Texas</dt><dd>6.25%</dd></div></dl></div></div>
  </div>
}

function TrialBalanceCard() {
  return <div className="card tb">
    <p className="tb-title">Trial balance check</p>
    <div className="tb-pair"><div><p>QuickBooks Online</p><b>$184,220.18</b></div><div><p>Pantry</p><b>$184,220.18</b></div></div>
    <p className="tb-match"><Check />Matches <Tick /></p>
    <ul className="tb-list"><li><Check />Open invoices<b>14</b></li><li><Check />Open bills<b>9</b></li><li><Check />Attachments<b>1,206</b></li></ul>
  </div>
}

export function Connected() {
  return <Feature id="connected" wide eyebrow="Connected" title={<>Stripe, Gusto and<br />sales tax, kept current.</>} art={<ConnectedCards />}
    label="A Stripe payout of $4,812.30 split into sales of $4,953.50 less $141.20 fees; Gusto payroll on Oct 15 of $4,206.50, balanced; sales tax tracked at 7.25% in California and 6.25% in Texas.">
    Payouts split into sales and fees, payroll posts as one balanced entry, and sales tax tracks by state.
  </Feature>
}

export function MoveIn() {
  return <Feature id="move-in" flip eyebrow="Move in" title={<>Bring your books<br />with you.</>} art={<TrialBalanceCard />}
    label="Trial balance check: QuickBooks Online $184,220.18 and Pantry $184,220.18 match; 14 open invoices, 9 open bills and 1,206 attachments carried over.">
    Move from QuickBooks Online or Xero with balances, open invoices and attachments, checked before you switch.
  </Feature>
}
