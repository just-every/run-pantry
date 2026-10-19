import { longDay, usd, type Data } from '../core'

const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
function underThousand(n: number): string {
  if (n >= 100) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ' ' + underThousand(n % 100) : ''}`
  if (n < 20) return ONES[n]
  return ['zero', 'ten', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')
}
export function amountWords(cents: number) {
  let n = Math.floor(cents / 100)
  const parts: string[] = []
  for (const [scale, name] of [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']] as const) {
    if (n >= scale) { parts.push(`${underThousand(Math.floor(n / scale))} ${name}`); n %= scale }
  }
  if (n || !parts.length) parts.push(underThousand(n))
  const words = parts.join(' ')
  return `${words[0].toUpperCase()}${words.slice(1)} and ${String(cents % 100).padStart(2, '0')}/100 dollars`
}

function checkFace(check: Data, alignment: boolean) {
  return `<section class="check-face${alignment ? ' alignment' : ''}">
    ${alignment ? '<strong class="align-title">ALIGNMENT ONLY — VOID</strong>' : ''}
    <span class="number" data-field="number">${alignment ? 'Check number' : escape(check.number)}</span>
    <span class="date" data-field="date">${alignment ? 'Date baseline' : escape(longDay(check.payment_date))}</span>
    <span class="payee" data-field="payee">${alignment ? 'Payee baseline +──────────────────────────────────+' : escape(check.payee)}</span>
    <span class="amount" data-field="amount">${alignment ? '$0.00' : escape(usd(check.amount_cents))}</span>
    <span class="words" data-field="words">${alignment ? 'Written amount baseline +────────────────────────────────────────+' : escape(amountWords(check.amount_cents))}</span>
    <span class="memo" data-field="memo">${alignment ? 'Memo baseline +────────────────────+' : escape(check.memo)}</span>
    ${check.status === 'void' ? '<strong class="void">VOID</strong>' : ''}
  </section>`
}
function stub(check: Data, batch: Data, label: string) {
  return `<section class="stub"><h2>${escape(batch.business_name)} · ${escape(label)}</h2>
    <p>Check ${escape(check.number)} · ${escape(longDay(check.payment_date))} · ${escape(check.payee)} · ${escape(usd(check.amount_cents))}${check.status === 'void' ? ' · VOID' : ''}</p>
    <p>${escape(batch.bank_name)} · …${escape(batch.number_last4)} · ${escape(check.memo)}</p>
    <table><thead><tr><th>Bill / expense</th><th>Amount paid</th></tr></thead><tbody>${check.allocations.map((a: Data) => `<tr><td>${escape(a.reference)}</td><td>${escape(usd(a.amount_cents))}</td></tr>`).join('')}</tbody></table>
    ${check.status === 'void' ? `<p>Voided ${escape(check.void_date)}: ${escape(check.void_reason)}</p>` : ''}</section>`
}

/** US Letter overlays for preprinted bank check stock. Never generate MICR,
 * routing/account information or a signature; those belong to the real stock. */
export function printableChecks(batch: Data, { alignment = false }: { alignment?: boolean } = {}) {
  const checks: Data[] = alignment ? [{}, {}, {}] : batch.checks
  const stock = batch.stock, x = Number(batch.offset_x_mm), y = Number(batch.offset_y_mm)
  const pages: string[] = []
  if (stock === 'voucher') {
    for (const check of alignment ? checks.slice(0, 1) : checks) pages.push(`<article class="sheet"><div class="overlay">${checkFace(check, alignment)}${alignment
      ? '<section class="stub alignment"><h2>Voucher stub 1 · 3½ inches</h2><p>Alignment only — no check has been issued.</p></section><section class="stub alignment"><h2>Voucher stub 2 · 3½ inches</h2></section>'
      : stub(check, batch, 'Payee voucher') + stub(check, batch, 'Business copy')}</div></article>`)
  } else {
    for (let i = 0; i < checks.length; i += 3) pages.push(`<article class="sheet"><div class="overlay">${checks.slice(i, i + 3).map(check => checkFace(check, alignment)).join('')}</div></article>`)
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${alignment ? 'Check alignment page' : 'Check batch'} · ${escape(batch.business_name)}</title>
  <style>
    @page {size: letter portrait; margin: 0} * {box-sizing:border-box} body {margin:0;background:#e8e8e8;color:#111;font-family:Arial,sans-serif}
    .toolbar {padding:16px;background:white;position:sticky;top:0;z-index:2} .toolbar p{margin:8px 0} button{font:inherit;padding:8px 16px}
    .sheet {position:relative;width:8.5in;height:11in;margin:20px auto;background:white;break-after:page;overflow:hidden}
    .sheet:last-child{break-after:auto} .overlay{position:absolute;left:.25in;top:.25in;width:8in;transform:translate(${x}mm,${y}mm)}
    .check-face,.stub{position:relative;width:8in;height:3.5in;overflow:hidden;font-size:12pt}
    .number{position:absolute;right:.28in;top:.08in;font-size:11pt}.date{position:absolute;left:6.2in;top:.55in;font-size:10pt}
    .payee{position:absolute;left:.65in;top:1.05in;max-width:5.45in;white-space:nowrap;font-size:12pt}
    .amount{position:absolute;right:.3in;top:1.05in;white-space:nowrap;font-size:12pt}.words{position:absolute;left:.15in;top:1.5in;right:.25in;font-size:10pt}
    .memo{position:absolute;left:.4in;top:2.45in;max-width:4.1in;font-size:10pt;white-space:nowrap}.void{position:absolute;top:1.8in;left:3in;font-size:52pt;transform:rotate(-15deg)}
    .stub{padding:.2in;font-size:10pt;border-top:1px dashed #888}.stub h2{font-size:12pt}.stub table{width:100%;border-collapse:collapse;font-size:10pt}.stub th{text-align:left}.stub td:last-child,.stub th:last-child{text-align:right}
    .alignment{outline:1px dashed #555;outline-offset:-1px;background:repeating-linear-gradient(0deg,transparent,transparent calc(.25in - 1px),#ddd calc(.25in - 1px),#ddd .25in)}
    .align-title{position:absolute;top:.1in;left:.15in;font-size:12pt}
    @media print {body{background:white}.toolbar{display:none}.sheet{margin:0}}
  </style></head><body><header class="toolbar"><h1>${alignment ? 'Check alignment page' : 'Check batch'}</h1><p>${escape(batch.business_name)} · ${stock === 'voucher' ? 'Voucher stock: one check and two vouchers per page' : 'Three checks per page'} · US Letter</p>
  <p>Print at actual size (100%), with browser headers and footers off. Use plain paper for alignment, then compare against your preprinted bank stock. Check area is 3½ inches high. Adjust horizontal and vertical offsets in Checks setup.</p>
  <p>${alignment ? 'This alignment page consumes no check number.' : 'Load the matching preprinted bank check stock in number order. This page supplies no MICR line or signature. Printing again uses the same numbers; destroy spoiled copies before reprinting.'}</p><button type="button" onclick="window.print()">Print ${alignment ? 'alignment page' : 'checks'}</button></header>${pages.join('')}</body></html>`
}
