import { ACCOUNTANT, CLOSE, LOCKED } from '../book'
import { Check, Icon, SideSection } from '../parts'

/** Nov 2, the month-end close: every balance reconciled, the accountant's one answer, and October locked. The page's
 * only checklist with an avatar (the move-in card keeps a plain sign-off line). */
function CloseCard() {
  return <div className="card close">
    <p className="close-title">October 2026 close</p>
    <ul className="close-list">{CLOSE.map(([what, value]) => <li key={what}><Check /><span>{what}</span><b>{value}</b></li>)}</ul>
    <div className="close-answer"><span className="avatar">JK</span><div><p><b>{ACCOUNTANT}:</b> Prepaid. Expense it in November.</p><span className="chip chip-green">Moved to Prepaid expenses</span></div></div>
    <p className="close-lock"><Icon name="lock" />{LOCKED}</p>
  </div>
}

export function Close() {
  return <SideSection id="close" artFirst className="close-sec" eyebrow="Nov 2 · Month-end close" title={<>Closed with<br />your accountant.</>}
    body="Everything reconciles before Jordan opens it. One judgment call, one answer, and October is locked."
    label={`October 2026 close: ${CLOSE.map(([w, v]) => `${w} ${v}`).join('; ')}. ${ACCOUNTANT} answered: Prepaid. Expense it in November. Moved to Prepaid expenses. ${LOCKED}.`}>
    <CloseCard />
  </SideSection>
}
