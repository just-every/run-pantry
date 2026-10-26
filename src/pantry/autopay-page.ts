import type { Data } from './core'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function autopayPanel(token: string, state: Data) {
  const base = `/i/${escape(token)}/autopay`, saved = state.saved
  if (!state.policy?.valid && !saved) return ''
  const savedCopy = saved ? `<p>Saved ${saved.method === 'card' ? 'card' : 'ACH bank account'}. ${saved.active ? 'Autopay authorized.' : 'Autopay is off.'}</p>` : ''
  const revoke = saved && !saved.revoked ? `<form method="post" action="${base}/stop"><button type="submit">Revoke autopay</button></form>` : ''
  const setup = state.policy?.valid && state.methods.length ? `<details><summary>Save a method for recurring invoices</summary><form method="post" action="${base}/start"><input type="hidden" name="policyRevision" value="${escape(state.policy.revision)}"><label>Payment method <select name="method">${state.methods.map((m: string) => `<option value="${m}">${m === 'card' ? 'Card' : 'Bank account (ACH)'}</option>`).join('')}</select></label><p>${escape(state.mandateText)}</p><label><input type="checkbox" name="accepted" required> I authorize these recurring charges and agree to the authorization above.</label><p><button type="submit">Continue to Stripe to save method</button></p></form></details>` : ''
  return `<section aria-label="Autopay"><h2>Recurring payments</h2>${savedCopy}${revoke}${setup}</section>`
}
