import { Fault, requireThat, type Data } from '../core'
import { form, STRIPE_VERSION } from '../stripe-api'

/** A confirmed decline is a provider outcome; an unreadable response is never a retry grant. */
export async function createAutopayIntent(key: string, params: Data, id: string) {
  let response: Response
  try {
    response = await fetch('https://api.stripe.com/v1/payment_intents', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'stripe-version': STRIPE_VERSION, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `pantry-autopay-${id}` }, body: form(params) })
  } catch { throw new Fault(502, 'Automatic payment outcome is unknown; reconcile in Stripe before submitting another payment') }
  const data = await response.json().catch(() => null) as Data | null
  const pi = response.ok ? data : response.status === 402 ? data?.error?.payment_intent : null
  requireThat(pi?.id && typeof pi.status === 'string', 'Stripe did not return a confirmed payment outcome; review this attempt in Stripe', 502)
  return pi
}
