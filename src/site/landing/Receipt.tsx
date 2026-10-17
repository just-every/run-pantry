// The Home Depot receipt from the bank-feed story, typed as a till prints it. California sales tax at 7.25%:
// $291.36 of goods and $21.12 tax make the $312.48 the card was charged on Oct 13.
export const RECEIPT = {
  store: ['1234 EL CAMINO REAL', 'SAN BRUNO, CA 94066'],
  meta: ['0607  00062  48872', '10/13/26', '14:27'],
  lines: [['1001372715  2X4-8FT STUD', '6 @ 2.06', '12.36'], ['0000-345-276  DEWALT DRILL', '', '279.00']],
  subtotal: '291.36', tax: '21.12', total: '312.48', card: 'VISA  •••• 4417',
}

/** The receipt itself: `marks` draws the boxes Pantry read (vendor, date, total); `mini` is the thumbnail.
 * The store is a plain name block with the same "HD" tile as the card line, never the store's own mark. */
export function ReceiptPaper({ marks = false, mini = false }: { marks?: boolean; mini?: boolean }) {
  const r = RECEIPT
  return <div className={`receipt-paper${mini ? ' mini' : ''}${marks ? ' marked' : ''}`}>
    <div className="receipt-head"><span className="receipt-logo">HD</span><span className="receipt-name">HOME DEPOT<br />STORE {r.meta[0].slice(0, 4)}</span></div>
    <p className="receipt-store">{r.store[0]}<br />{r.store[1]}</p>
    <p className="receipt-meta"><span>{r.meta[0]}</span><span className="receipt-date">{r.meta[1]}</span><span>{r.meta[2]}</span></p>
    {r.lines.map(([item, qty, price]) => <p className="receipt-line" key={item}><span>{item}{qty && <><br />{'      '}{qty}</>}</span><span>{price}</span></p>)}
    <div className="receipt-sums"><p className="receipt-line"><span>SUBTOTAL</span><span>{r.subtotal}</span></p><p className="receipt-line"><span>SALES TAX 7.25%</span><span>{r.tax}</span></p>
      <p className="receipt-line total"><b>TOTAL</b><b className="receipt-total">${r.total}</b></p></div>
    <p className="receipt-line"><span>{r.card}</span><span>${r.total}</span></p>
  </div>
}
