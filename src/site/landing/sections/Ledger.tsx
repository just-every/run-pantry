import { LEDGER, type LedgerRow } from '../book'
import { Chevron, HeadSection, Icon } from '../parts'

/** Oct 1–19 across Chase and Amex in one ledger: a matched deposit, a rule, two rows for review, the receipt,
 * the Stripe payout split into sales and fees, the Gusto payroll journal and INV-0231 paid by ACH. */
const Flag = ({ children }: { children: string }) => <span className="chip chip-apricot">{children}</span>

function Row({ r }: { r: LedgerRow }) {
  const coded = r.flag === 'coded' ? <Flag>{r.coded}</Flag> : r.coded
  const how = r.flag === 'how' ? <Flag>{r.how}</Flag> : r.receipt ? <><Icon name="doc" />{r.how}</> : r.split ? <>{r.how}<Chevron /></> : r.how
  return <div className="lg-group">
    <div className="lg-row">
      <span className="lg-date">{r.date}</span><span className="lg-payee">{r.payee}</span><span className={`lg-amount${r.inflow ? ' good' : ''}`}>{r.amount}</span>
      <span className="lg-meta dots"><span className="lg-account">{r.account}</span><span className="lg-coded">{coded}</span><span className="lg-how">{how}</span></span>
    </div>
    {r.split && <div className="lg-split"><div className="lg-tree">{r.split.map(([what, amount], i) =>
      <p key={what} className={i === r.split!.length - 1 ? 'net' : ''}><span>{what}</span><span>{amount}</span></p>)}</div></div>}
  </div>
}

export function Ledger() {
  return <HeadSection id="feeds" className="ledger-sec" eyebrow="Oct 1–19 · Bank and card feeds" title="Every transaction, already in."
    body="Chase, Amex, Stripe and Gusto land in one ledger. Rules code the routine. Payouts and payroll split into real entries."
    label={`Ledger, October 2026, all accounts, 2 need review: ${LEDGER.map(r => `${r.date}, ${r.account}, ${r.payee}, ${r.amount}, coded as ${r.coded}, ${r.how}${r.split ? ` (${r.split.map(([w, a]) => `${w} ${a}`).join(', ')})` : ''}`).join('; ')}.`}>
    <div className="card ledger">
      <div className="lg-head">
        <p className="lg-title">Ledger · October 2026</p>
        <div className="lg-tools"><span className="lg-filter">All accounts<Icon name="down" /></span><span className="lg-review">Needs review<b>2</b></span></div>
      </div>
      <div className="lg-row lg-cols"><span>Date</span><span>Account</span><span>Payee</span><span className="lg-amount-col">Amount</span><span>Coded as</span><span>How</span></div>
      {LEDGER.map(r => <Row key={r.date + r.payee} r={r} />)}
    </div>
  </HeadSection>
}
