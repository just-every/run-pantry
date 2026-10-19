// Private customer preferences shared by deliberate edits and invoice delivery.
import { optionalText, requireThat, type Data } from './core'

const METHODS = ['card', 'us_bank_account', 'offline']
const ROLES = ['primary', 'billing', 'cc']
const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/
type CustomerContact = { name: string; email: string; phone: string; roles: string[] }

export function customerContacts(customer: Data): CustomerContact[] {
  return typeof customer.contacts_json === 'string' ? JSON.parse(customer.contacts_json) : customer.contacts ?? []
}

/** Billing and cc form the default recipient set; primary alone is informational. */
export function customerRecipients(customer: Data): string[] {
  const emails = customerContacts(customer).filter(c => c.roles.some(r => r === 'billing' || r === 'cc')).map(c => c.email).filter(Boolean)
  return [...new Set((emails.length ? emails : customer.email ? [customer.email] : []).map(email => email.trim().toLowerCase()))]
}

export function customerPaymentMethods(customer: Data): string[] {
  const stored = typeof customer.pay_methods === 'string' ? JSON.parse(customer.pay_methods) : customer.pay_methods
  return stored === null || stored === undefined ? [...METHODS] : stored
}

/** Omitted fields retain their saved values; empty inputs deliberately clear them. */
export function customerProfile(b: Data, current?: Data | null) {
  const value = (input: string, column: string, label: string, max: number) => b[input] === undefined ? current?.[column] ?? '' : optionalText(b[input], label, max)
  let contacts = customerContacts(current ?? {})
  if (b.contacts !== undefined) {
    requireThat(Array.isArray(b.contacts) && b.contacts.length <= 30, 'Add at most 30 customer contacts')
    contacts = b.contacts.map((raw: unknown, i: number) => {
      requireThat(raw && typeof raw === 'object' && !Array.isArray(raw), `Contact ${i + 1} must be an object`)
      const c = raw as Data, name = optionalText(c.name, `Contact ${i + 1} name`, 200)
      const email = optionalText(c.email, `Contact ${i + 1} email`, 254).toLowerCase(), phone = optionalText(c.phone, `Contact ${i + 1} phone`, 60)
      requireThat(name || email, `Contact ${i + 1} needs a name or email`)
      requireThat(!email || EMAIL.test(email), `Contact ${i + 1} needs a valid email`)
      requireThat(Array.isArray(c.roles) && c.roles.every((r: unknown) => typeof r === 'string' && ROLES.includes(r)), `Contact ${i + 1} roles are primary, billing or cc`)
      const roles = [...new Set<string>(c.roles)]
      requireThat(!roles.some(r => r === 'billing' || r === 'cc') || email, `Contact ${i + 1} needs an email for billing or cc`)
      return { name, email, phone, roles }
    })
  }
  let payMethods = current?.pay_methods ?? null
  if (b.payMethods !== undefined) {
    requireThat(b.payMethods === null || (Array.isArray(b.payMethods) && b.payMethods.every((m: unknown) => typeof m === 'string' && METHODS.includes(m))), 'Payment methods are card, us_bank_account or offline')
    payMethods = b.payMethods === null ? null : JSON.stringify([...new Set<string>(b.payMethods)])
  }
  return { contacts: JSON.stringify(contacts), payMethods,
    billingAddress: value('billingAddress', 'billing_address', 'Billing address', 1000),
    serviceAddress: value('serviceAddress', 'service_address', 'Service address', 1000),
    phone: value('phone', 'phone', 'Phone', 60), internalNotes: value('internalNotes', 'internal_notes', 'Internal notes', 10000) }
}
