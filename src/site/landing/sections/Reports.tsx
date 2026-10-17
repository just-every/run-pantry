import { COGS, COGS_MORE, COGS_TOTAL, CONTRACTORS, NET_INCOME, PL } from '../book'
import { HeadSection } from '../parts'

/** Nov 3, the reports: October's accrual P&L summing to $11,040, cost of goods sold opened to its 14 entries, and
 * the 1099-NEC contractors for 2026 at the $2,000 threshold. */
const Pointer = () => <svg className="pl-pointer" viewBox="0 0 20 26"><path d="M2 2v19l5-4.6 3.6 7.6 3.2-1.5-3.6-7.4H17z" /></svg>

export function Reports() {
  return <HeadSection id="reports" className="reports" eyebrow="Nov 3 · Reports" title="Click any number."
    body="P&L, balance sheet and cash flow, on cash or accrual. Every figure opens to the bills, receipts and vendors behind it."
    label={`Profit and loss, October 2026, accrual basis: ${PL.map(([w, a]) => `${w} ${a}`).join(', ')}, net income ${NET_INCOME}. Cost of goods sold opens to 14 entries: ${COGS.map(([d, w, a]) => `${d} ${w} ${a}`).join('; ')}; ${COGS_MORE.join(' ')}; total ${COGS_TOTAL}. 1099-NEC 2026: ${CONTRACTORS.map(([, n, a, s]) => `${n} ${a}, ${s}`).join('; ')}.`}>
    <div className="rp-grid">
      <div className="card pl">
        <div className="pl-head"><p className="card-title">Profit and loss · October 2026</p><span className="toggle"><span className="on">Accrual</span><span>Cash</span></span></div>
        <p className="pl-tabs"><span className="on">P&amp;L</span><span>Balance sheet</span><span>Cash flow</span><span>Aging</span></p>
        {PL.map(([what, amount], i) => <p key={what} className={`pl-row${i === 1 ? ' hot' : ''}`}><span>{what}</span><span>{amount}</span>{i === 1 && <Pointer />}</p>)}
        <p className="pl-row pl-net"><b>Net income</b><b>{NET_INCOME}</b></p>
      </div>
      <span className="pl-lead"><i /><i /></span>
      <div className="rp-side">
        <div className="card cogs">
          <p className="card-title">Cost of goods sold · 14 entries</p>
          {COGS.map(([date, what, amount]) => <p key={what} className="cogs-row"><span>{date} · {what}</span><span>{amount}</span></p>)}
          <p className="cogs-row"><span>{COGS_MORE[0]}</span><span>{COGS_MORE[1]}</span></p>
          <p className="cogs-row cogs-total"><b>Total</b><b>{COGS_TOTAL}</b></p>
        </div>
        <div className="card nec">
          <p className="card-title">1099-NEC · 2026</p>
          {CONTRACTORS.map(([initial, name, amount, status, tone]) => <p key={name} className="nec-row"><span className={`nec-initial ${tone}`}>{initial}</span><span className="nec-name">{name}</span><span className="nec-amount">{amount}</span><span className="nec-status">{status}</span></p>)}
        </div>
      </div>
    </div>
  </HeadSection>
}
