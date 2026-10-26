import { processStripeEvent } from './stripe-events'
// The customer's side of a sent invoice: /i/<token> shows the invoice, its PDF
// and how to pay it, without signing in. The first opening by someone who is
// not signed in to these books is recorded as "viewed". Paying sends the
// customer to Stripe Checkout; Stripe's webhook only names a session, which
// Pantry then reads back from Stripe before recording anything.
import { Hono } from 'hono'
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { fontHead } from '../base/font-head'
import { themeFrame } from '../base/theme-frame'
import branding from '../branding.json'
import { pantry } from './access'
import { Fault, longDay, now, usd, type Data } from './core'
import { all, audit, one, run } from './db'
import { invoiceByLink, LINK_TOKEN } from './invoice-links'
import { invoiceDocument } from './delivery'
import { issuedDocument } from './invoice-documents'
import { checkoutAmount, offeredMethods, startCheckout, stripeSettings, syncCheckout } from './stripe'
import { percentLabel } from './discounts'
import { unseal, verifySignature } from './stripe-api'

export const customer = new Hono<{ Bindings: Bindings }>()

const escape = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// In Pantry's look (rer-theme.css tokens): the white card on the lavender paper, tracked-caps heads,
// green for paid and apricot for what is due, the navy pill to pay.
const STYLE = '.invoice-pdf{width:100%;height:640px;border:0}' + '.rer-themed main.invoice{max-width:720px}.rer-themed main.invoice h1{text-align:left}'
  + '.invoice .status{display:inline-block;margin:0 0 20px;padding:4px 12px;border-radius:999px;background:var(--row);color:var(--ink);font-size:14px;font-weight:600}'
  + '.invoice .status.paid{background:var(--green-tint);color:var(--green-ink)}.invoice .status.due{background:var(--apricot-tint);color:var(--apricot-text)}'
  + '.invoice table{width:100%;border-collapse:collapse;margin:0 0 16px}.invoice th,.invoice td{padding:10px 4px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;color:var(--ink)}'
  + '.invoice th{color:var(--lavender-ink);font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase}.invoice .fig{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}'
  + '.invoice .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 24px;margin:0 0 24px}.invoice .facts span,.invoice .totals span{display:block;font-size:14px;color:var(--soft)}.invoice .facts strong{font-weight:600;color:var(--ink)}'
  + '.invoice .totals{display:grid;grid-template-columns:1fr auto;align-items:baseline;gap:6px 24px;max-width:320px;margin:0 0 24px auto;font-variant-numeric:tabular-nums}.invoice .totals strong{text-align:right;font-weight:500;color:var(--ink)}.invoice .totals .due{font-weight:700;color:var(--ink)}'
  + '.invoice .history{list-style:none;padding:0;margin:0 0 20px}.invoice .history li{padding:8px 0;border-bottom:1px solid var(--line);color:var(--ink)}'
  + '.invoice .pay{display:grid;gap:12px;margin:0 0 20px}.invoice .pay form{margin:0}.invoice .pay form+form button{background:var(--surface);color:var(--ink);border:1px solid var(--line-strong);box-shadow:none}'
  + '.invoice .note{font-size:14px}.invoice h2{font-size:18px;margin:28px 0 8px}.invoice .from{margin:0 0 4px;font-weight:600;color:var(--lavender-ink);font-size:13px;letter-spacing:.12em;text-transform:uppercase}'
  + '@media(max-width:480px){.invoice th:nth-child(2),.invoice td:nth-child(2){display:none}}'
const digest = async (text: string) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))))

async function page(status: number, title: string, body: string) {
  const frame = await themeFrame({ href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor })
  const policy = frame.policy.replace("style-src 'self'", `style-src 'self' 'sha256-${await digest(STYLE)}'`)
  const html = `<!doctype html><html lang="en"${frame.htmlClass}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title>${fontHead}${frame.head}<style>${STYLE}</style></head><body><main class="invoice">${body}</main></body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow',
    'content-security-policy': `default-src 'none'; frame-src 'self'; ${policy}; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'; base-uri 'none'` } })
}

const notFound = () => page(404, 'Invoice not found', '<h1>Invoice not found</h1><p>This invoice link is not valid. Ask the business that sent it for a new one.</p>')

/** Someone signed in to these books looking at the page is not the customer viewing it. */
async function staff(request: Request, env: Bindings) {
  return !!await operatorAuth(runtimeBindings(env)).getSession(request)
}

customer.get('/i/:token', async c => {
  const db = c.env.DB, token = c.req.param('token')
  let inv = await invoiceByLink(db, token)
  if (!inv) return notFound()
  const returned = c.req.query('checkout')
  let outcome = ''
  if (returned && /^cs_[A-Za-z0-9_]+$/.test(returned)) {
    const owned = await one(db, 'SELECT id FROM pt_stripe_payments WHERE id = ? AND invoice_id = ?', returned, inv.id)
    if (owned) {
      const r = await syncCheckout(c.env, db, returned).catch(error => { if (error instanceof Fault) return null; throw error })
      outcome = r?.status === 'succeeded' ? '<p class="status paid" role="status">Thank you: your payment was received.</p>'
        : r?.status === 'processing' ? '<p class="status due" role="status">Your bank payment is processing. Banks usually take a few business days; this page shows it as paid when it clears.</p>'
        : '<p class="status due" role="status">Stripe has not confirmed a payment yet. If you paid, this page updates when it does.</p>'
      inv = await invoiceByLink(db, token)
      if (!inv) return notFound()
    }
  }
  if (!inv.viewed_at && !await staff(c.req.raw, c.env)) {
    const r = await db.prepare('UPDATE pt_invoices SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL').bind(now(), inv.id).run()
    if (r.meta.changes === 1) await run(db, [audit(pantry('customer'), 'invoice.viewed', 'invoice', inv.id)])
  }
  const doc = await invoiceDocument(db, inv), paid = inv.open_cents <= 0
  const processing = await one(db, "SELECT 1 FROM pt_stripe_payments WHERE invoice_id = ? AND status = 'processing'", inv.id)
  const overdue = !paid && inv.due_date < new Date().toISOString().slice(0, 10)
  const chip = inv.disputed_cents > 0 ? '<p class="status due">Payment disputed</p>' : paid ? '<p class="status paid">Paid</p>' : processing ? '<p class="status due">Payment processing</p>' : `<p class="status due">${overdue ? 'Overdue · was due' : 'Due'} ${escape(longDay(inv.due_date))}</p>`
  const offered = paid || processing ? [] : await offeredMethods(c.env, db, inv.customer_id)
  const methods = offered.filter(m => m !== 'offline')
  // INVOICE-010: a live early-payment offer is charged at the amount still due for its discount; afterwards the page says how it ended.
  const charge = paid ? null : await checkoutAmount(db, inv), early = charge?.early ?? null
  const offerNote = !early ? ''
    : early.state === 'live' && charge!.windowEnd ? `<p class="status due">Early-payment discount: ${escape(percentLabel(early.offer.percentMilli))} if paid by ${escape(longDay(early.offer.windowEnd))}. Pay ${escape(usd(charge!.amount))} by then.</p>`
    : early.state === 'withdrawn' ? `<p class="note">Early-payment discount ended by ${escape(early.credit ?? 'a credit')}.</p>`
    : early.state === 'taken' ? `<p class="note">Early-payment discount taken: ${escape(early.credit ?? '')}.</p>`
    : `<p class="note">Early-payment discount ended ${escape(longDay(early.offer.windowEnd))}.</p>`
  const online = methods.length
    ? `<h2>Pay ${escape(usd(charge?.amount ?? inv.open_cents))}${charge?.windowEnd ? ` by ${escape(longDay(charge.windowEnd))}` : ''}</h2><div class="pay">${methods.map(m => `<form method="post" action="/i/${escape(token)}/pay"><input type="hidden" name="method" value="${m}"><button type="submit">Pay by ${m === 'card' ? 'card' : 'bank account (ACH)'}</button></form>`).join('')}</div><p class="note">Payment is handled by Stripe. Your card or bank details go to Stripe, never to ${escape(doc.business)}'s books.</p>`
    : ''
  const offline = offered.includes('offline') ? `<h2>How to pay</h2><p class="note">This invoice can be paid to ${escape(doc.business)} directly. Pay with the details they gave you, such as their bank transfer or check details, or reply to the invoice email to ask for them.</p>` : ''
  const pay = online + offline
  const history = await all(db, `SELECT p.payment_date, a.amount_cents, p.memo FROM pt_allocations a JOIN pt_payments p ON p.id = a.source_id AND a.source_kind = 'payment'
    WHERE a.target_kind = 'invoice' AND a.target_id = ? AND p.reversal_id IS NULL
    UNION ALL SELECT a.allocation_date, -a.amount_cents, CASE WHEN cr.early_discount = 1 THEN 'Early-payment discount ' || cr.number || ' (sales tax -' || printf('$%.2f', cr.tax_cents / 100.0) || ')' ELSE 'Credit ' || cr.number END
    FROM pt_allocations a JOIN pt_invoices cr ON cr.id = a.source_id AND a.source_kind = 'credit' WHERE a.target_kind = 'invoice' AND a.target_id = ? AND a.voided_by IS NULL ORDER BY 1`, inv.id, inv.id)
  const body = `<p class="from">${escape(doc.business)}</p><h1>${escape(doc.title)}</h1>${outcome}${chip}
    <div class="facts">${doc.facts.map(([k, v]) => `<div><span>${escape(k)}</span><strong>${escape(v)}</strong></div>`).join('')}</div>
    <table><thead><tr><th>Description</th><th class="fig">Quantity</th><th class="fig">Amount</th></tr></thead><tbody>${doc.lines.map((l: Data) => `<tr><td>${escape(l.description)}</td><td class="fig">${escape(l.quantity)}</td><td class="fig">${escape(l.amount)}</td></tr>`).join('')}</tbody></table>
    <div class="totals">${doc.totals.map(([k, v]) => `<span${k === 'Amount due' ? ' class="due"' : ''}>${escape(k)}</span><strong${k === 'Amount due' ? ' class="due"' : ''}>${escape(v)}</strong>`).join('')}</div>
    ${doc.notes.map(n => `<p>${escape(n)}</p>`).join('')}<p class="note">Current balance: ${escape(usd(inv.open_cents))}. The issued document is retained as originally issued.</p>${offerNote}${pay}
    ${history.length ? `<h2>Payments</h2><ul class="history">${history.map(h => `<li>${escape(longDay(h.payment_date))}: ${escape(usd(h.amount_cents))} · ${escape(h.memo || 'Payment received')}</li>`).join('')}</ul>` : ''}
    <iframe title="Issued invoice PDF" src="/i/${escape(token)}/invoice.pdf" class="invoice-pdf"></iframe><p class="note"><a href="/i/${escape(token)}/invoice.pdf">Download the invoice (PDF)</a></p>`
  return page(200, `${doc.title} · ${doc.business}`, body)
})

customer.get('/i/:token/invoice.pdf', async c => {
  const inv = await invoiceByLink(c.env.DB, c.req.param('token'))
  if (!inv) return notFound()
  return new Response((await issuedDocument(c.env.DB, inv.id)).pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${inv.number.replace(/[^\w.-]+/g, '_')}.pdf"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } })
})

customer.post('/i/:token/pay', async c => {
  const token = c.req.param('token')
  if (!LINK_TOKEN.test(token)) return notFound()
  if (!await invoiceByLink(c.env.DB, token)) return notFound()
  const form = await c.req.parseBody()
  try {
    const url = await startCheckout(c.env, c.env.DB, token, String(form.method ?? ''))
    return new Response(null, { status: 303, headers: { location: url, 'cache-control': 'no-store' } })
  } catch (error) {
    if (!(error instanceof Fault)) throw error
    if (error.status === 404) return notFound()
    return page(error.status, 'Payment not started', `<h1>Payment not started</h1><p>${escape(error.message)}</p><p><a href="/i/${escape(token)}">Back to the invoice</a></p>`)
  }
})

// Stripe names the session; Pantry reads its state back from Stripe itself.
customer.post('/api/pantry/stripe/webhook', async c => {
  const s = await stripeSettings(c.env.DB)
  const body = await c.req.text()
  if (!s?.webhook_secret_sealed || !await verifySignature(await unseal(c.env, s.webhook_secret_sealed), c.req.header('stripe-signature') ?? '', body)) return c.json({ error: 'Signature not valid' }, 400)
  const event = JSON.parse(body)
  await processStripeEvent(c.env,c.env.DB,event)
  return c.json({ received: true })
})
