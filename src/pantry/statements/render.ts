import { usd, type Data } from '../core'
import { statementStyle } from './style'

export const statementTitles = { 'open-items': 'Open-item statement', 'balance-forward': 'Balance-forward statement', 'transaction-list': 'Transaction-list statement' }
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function renderStatement(snapshot: Data, origin: string) {
  const title = statementTitles[snapshot.mode as keyof typeof statementTitles]
  const subject = `${title} from ${snapshot.business_name} · ${snapshot.to}`
  const opening = `Opening balance before ${snapshot.from}: ${usd(snapshot.opening_balance_cents)}`
  const closing = `Balance as of ${snapshot.to}: ${usd(snapshot.closing_balance_cents)}`
  const ageing = `Open invoices: ${usd(snapshot.open_invoice_cents)}; unapplied payments: ${usd(snapshot.unallocated_payment_cents)}; unapplied credits: ${usd(snapshot.unallocated_credit_cents)}`
  const range = snapshot.mode === 'open-items' ? `Open items as of ${snapshot.to}` : `Transactions from ${snapshot.from} to ${snapshot.to}`
  const source = (r: Data) => new URL(r.href, origin).href
  const line = (r: Data) => `${r.date} · ${r.kind} · ${r.reference}${r.due_date ? ` · due ${r.due_date}` : ''} · ${usd(r.amount_cents)} · balance ${usd(r.running_balance_cents)}\nSource record (sign-in required): ${source(r)}`
  const text = [snapshot.business_name, title, snapshot.customer_name, range,
    ...(snapshot.mode === 'open-items' ? [] : [opening]), ...snapshot.rows.map(line), closing, ageing,
    'This statement reflects recorded invoices, payments and credits as of the dates shown.'].join('\n')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(subject)}</title><style>${statementStyle}</style></head><body><main class="statement"><p class="from">${escape(snapshot.business_name)}</p><h1>${escape(title)}</h1><h2>${escape(snapshot.customer_name)}</h2><div class="facts"><div><span>Statement dates</span><strong>${escape(range)}</strong></div><div><span>Balance date</span><strong>${escape(snapshot.to)}</strong></div></div>${snapshot.mode === 'open-items' ? '' : `<p>${escape(opening)}</p>`}<table><thead><tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Reference</th><th scope="col">Due</th><th scope="col" class="fig">Amount</th><th scope="col" class="fig">Running balance</th></tr></thead><tbody>${snapshot.rows.map((r: Data) => `<tr><td data-label="Date">${escape(r.date)}</td><td data-label="Type">${escape(r.kind)}</td><td data-label="Reference"><a href="${escape(source(r))}" title="Source record · sign-in required">${escape(r.reference || r.kind)}</a></td><td data-label="Due">${escape(r.due_date ?? '—')}</td><td data-label="Amount" class="fig">${escape(usd(r.amount_cents))}</td><td data-label="Running balance" class="fig">${escape(usd(r.running_balance_cents))}</td></tr>`).join('')}</tbody></table><p class="balance"><strong>${escape(closing)}</strong></p><p class="summary">${escape(ageing)}</p><p class="note">This statement reflects recorded invoices, payments and credits as of the dates shown. Source records require sign-in.</p></main></body></html>`
  return { subject, text, html }
}
