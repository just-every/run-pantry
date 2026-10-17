// The Home Depot receipt from the bank-feed story, typed as a till prints it: $291.36 of goods and $21.12 tax make
// the $312.48 Chase's debit card (VISA •••• 4417) was charged on Tue Oct 13, 2026. The till prints the tax in dollars.
export const RECEIPT = {
  store: ['STORE 0607', '1234 EL CAMINO REAL', 'SAN BRUNO, CA 94066'],
  meta: ['0607 00062 48872', '10/13/26', '14:27'],
  lines: [['2X4-8FT STUD', '6 @ 2.06', '12.36'], ['DEWALT DRILL', '', '279.00']],
  subtotal: '291.36', tax: '21.12', total: '312.48', card: 'VISA •••• 4417',
}

/** The receipt itself, with `marks` drawing the boxes Pantry read (vendor, date, total). The store is a plain name
 * block with an "HD" tile, never the store's own mark. */
export function ReceiptPaper({ marks = false }: { marks?: boolean }) {
  const r = RECEIPT
  return <div className={`receipt-paper${marks ? ' marked' : ''}`}>
    <p className="receipt-head"><span className="receipt-logo">HD</span><span className="receipt-name">HOME DEPOT</span></p>
    <p className="receipt-store">{r.store.map(line => <span key={line}>{line}</span>)}</p>
    <p className="receipt-meta"><span>{r.meta[0]}</span><span className="receipt-date">{r.meta[1]}</span><span>{r.meta[2]}</span></p>
    <div className="receipt-items">{r.lines.map(([item, qty, price]) => <p className="receipt-line" key={item}><span>{item}</span><span>{qty}</span><span>{price}</span></p>)}</div>
    <div className="receipt-sums"><p className="receipt-line"><span>SUBTOTAL</span><span>{r.subtotal}</span></p><p className="receipt-line"><span>SALES TAX</span><span>{r.tax}</span></p></div>
    <p className="receipt-line receipt-total"><b>TOTAL</b><b>${r.total}</b></p>
    <p className="receipt-line receipt-card"><span>{r.card}</span><span>${r.total}</span></p>
  </div>
}

/** The hero's thumbnail of the same receipt: at that size the till's type reads as lines, so it is drawn as lines. */
const MINI = [[42, 0], [64, 0], [58, 0], [100, 1], [70, 2], [56, 2], [100, 3], [100, 3], [100, 4], [100, 5]]
export function ReceiptThumb() {
  return <div className="receipt-thumb">
    <span className="rt-head"><i /><b /></span>
    {MINI.map(([width, group], i) => <span key={i} className={`rt-line g${group}`} style={{ width: `${width}%` }} />)}
  </div>
}
