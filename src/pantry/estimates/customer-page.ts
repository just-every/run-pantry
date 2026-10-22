// The estimate's public document uses Pantry's customer invoice conventions.
// These styles are local to this page and never change the invoice renderer.
import { themeFrame } from '../../base/theme-frame'
import { fontHead } from '../../base/font-head'
import branding from '../../branding.json'
import type { Data } from '../core'
import type { InvoiceDocument } from '../invoice-pdf'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const STYLE = `
.rer-themed main.invoice.estimate{max-width:720px;min-width:0}
.rer-themed main.invoice.estimate h1{text-align:left;overflow-wrap:anywhere}
.estimate .from{margin:0 0 4px;font-weight:600;color:var(--lavender-ink);font-size:13px;letter-spacing:.12em;text-transform:uppercase}
.estimate .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px 24px;margin:24px 0}
.estimate .facts>div{min-width:0}
.estimate .facts span,.estimate .totals span{display:block;font-size:14px;color:var(--soft)}
.estimate .facts strong{display:block;font-weight:600;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere}
.estimate table{width:100%;border-collapse:collapse;margin:0 0 20px;table-layout:fixed}
.estimate th,.estimate td{padding:12px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;color:var(--ink);overflow-wrap:anywhere}
.estimate th:first-child,.estimate td:first-child{padding-left:0}
.estimate th:last-child,.estimate td:last-child{padding-right:0}
.estimate th{color:var(--lavender-ink);font-size:11.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase}
.estimate th:first-child{width:56%}.estimate th:nth-child(2){width:17%}.estimate th:last-child{width:27%}
.estimate .fig{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.estimate .totals{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:8px 24px;max-width:360px;margin:0 0 28px auto;font-variant-numeric:tabular-nums}
.estimate .totals strong{text-align:right;font-weight:500;color:var(--ink);white-space:nowrap}
.estimate .totals .total{font-weight:700;color:var(--ink)}
.estimate .notes p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}
.estimate .acceptance{margin-top:28px;padding-top:24px;border-top:1px solid var(--line)}
.estimate .acceptance form{max-width:440px}
.estimate .acceptance form p{font-size:14px;color:var(--soft)}
.estimate .accepted{padding:14px 18px;border-radius:12px;background:var(--green-tint);color:var(--green-ink);overflow-wrap:anywhere}
.estimate .download{margin:24px 0 0;font-size:14px}
@media(max-width:480px){
 .estimate .facts{grid-template-columns:minmax(0,1fr);gap:14px;margin:20px 0}
 .estimate table,.estimate tbody{display:block}
 .estimate thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
 .estimate tr{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;padding:14px 0;border-bottom:1px solid var(--line)}
 .estimate td{display:block;padding:0!important;border:0;min-width:0}
 .estimate td:first-child{grid-column:1/-1}
 .estimate td.fig{text-align:left;white-space:normal;overflow-wrap:anywhere}
 .estimate td.fig:before{content:attr(data-label);display:block;color:var(--soft);font-size:12px;margin-bottom:2px}
 .estimate .totals{max-width:none;gap:8px 16px;margin-bottom:24px}
 .estimate .totals span{overflow-wrap:normal}
}
`

const digest = async (value: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))))

export async function estimateCustomerPage(row: Data, doc: InvoiceDocument, token: string) {
  const frame = await themeFrame({ href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor })
  const policy = frame.policy.replace("style-src 'self'", `style-src 'self' 'sha256-${await digest(STYLE)}'`)
  const body = `<p class="from">${escape(doc.business)}</p><h1>${escape(doc.title)}</h1>
    <div class="facts">${doc.facts.map(([k, v]) => `<div><span>${escape(k)}</span><strong>${escape(v)}</strong></div>`).join('')}</div>
    <table><thead><tr><th scope="col">Description</th><th scope="col" class="fig">Quantity</th><th scope="col" class="fig">Amount</th></tr></thead><tbody>${doc.lines.map(l => `<tr><td>${escape(l.description)}</td><td class="fig" data-label="Quantity">${escape(l.quantity)}</td><td class="fig" data-label="Amount">${escape(l.amount)}</td></tr>`).join('')}</tbody></table>
    <div class="totals">${doc.totals.map(([k, v]) => `<span${k === 'Total' || k === 'Amount due' ? ' class="total"' : ''}>${escape(k)}</span><strong${k === 'Total' || k === 'Amount due' ? ' class="total"' : ''}>${escape(v)}</strong>`).join('')}</div>
    <div class="notes">${doc.notes.map(n => `<p>${escape(n)}</p>`).join('')}</div>
    <div class="acceptance">${row.status === 'accepted'
      ? `<p class="accepted" role="status">Accepted by ${escape(row.accepted_name)} on ${escape(row.accepted_at)}.</p>`
      : `<form method="post" action="/e/${escape(token)}/accept"><input type="hidden" name="revision" value="${escape(row.revision)}"><label for="accept-name">Your name</label><input id="accept-name" name="name" required maxlength="200" autocomplete="name"><p>Accept the estimate above by typing your name. Your name, time and IP address are retained as acceptance evidence.</p><button type="submit">Accept estimate</button></form>`}</div>
    <p class="download"><a href="/e/${escape(token)}/estimate.pdf">Download estimate PDF</a></p>`
  const html = `<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(doc.title)}</title>${fontHead}${frame.head}<style>${STYLE}</style></head><body><main class="invoice estimate">${body}</main></body></html>`
  return new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'same-origin',
    'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': `default-src 'none'; frame-src 'self'; ${policy}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
  } })
}
