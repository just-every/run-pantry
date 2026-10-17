import { LOWES } from '../book'
import { Check, Dots, Icon, SideSection } from '../parts'
import { ReceiptPaper } from '../Receipt'

/** Oct 13: the Home Depot receipt read on the phone (vendor, date and total boxed), filed on its Chase line; a
 * forwarded Lowe's order matched to Amex; and the emailed copy of the Home Depot receipt skipped as already attached. */
function Snap() {
  return <div className="snap">
    <div className="snap-top">
      <div className="phone">
        <p className="phone-status"><span>9:41</span><span className="phone-island" /><span className="phone-icons"><i /><i /><i /></span></p>
        <div className="phone-screen"><ReceiptPaper marks /></div>
      </div>
      <div className="card mail">
        <p className="mail-from"><span className="mail-icon"><Icon name="mail" /></span>{LOWES.from}</p>
        <p className="mail-subject">{LOWES.subject}</p>
        <p className="mail-match"><Dots text={LOWES.match.join(' · ')} /><Check /></p>
      </div>
    </div>
    <div className="card snap-line">
      <span className="sl-date">Oct 13</span><span className="sl-payee">Home Depot</span><span className="sl-amount">−$312.48</span><span className="sl-break" />
      <span className="sl-coded">Tools &amp; Equipment</span><span className="sl-how">Receipt attached<Check /></span>
    </div>
    <p className="snap-skip"><Dots text="Emailed copy skipped · already attached Oct 13" /></p>
  </div>
}

export function Receipts() {
  return <SideSection id="receipts" className="receipts" eyebrow="Oct 13 · Receipts" title="Snap it or forward it."
    body="Pantry reads the vendor, date and total, finds the card charge, and files each receipt once."
    label={`A Home Depot receipt photographed on a phone: store 0607, 1234 El Camino Real, San Bruno, CA, 10/13/26 at 14:27, total $312.48 on VISA •••• 4417, with the vendor, date and total boxed. It is filed on the Oct 13 Home Depot line, −$312.48, Tools & Equipment, receipt attached; the emailed copy was skipped as already attached Oct 13. A forwarded email, ${LOWES.subject}, forwarded by Maya: ${LOWES.match.join(', ')}.`}>
    <Snap />
  </SideSection>
}
