// What a document says about its vendor. Routing/account numbers are deliberately
// outside this schema: reading a receipt cannot change payment instructions.
import { sha256, type Data } from '../core'

export type VendorDetails = {
  email: string | null; address: string | null; phone: string | null
  ein?: string | null; einHash?: string | null; einLast4?: string | null
}
const nullable = { anyOf: [{ type: 'string' }, { type: 'null' }] }
export const VENDOR_DETAILS_SCHEMA = {
  anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
    required: ['email', 'address', 'phone', 'ein'],
    properties: { email: nullable, address: nullable, phone: nullable, ein: nullable } }],
}
export const VENDOR_DETAILS_INSTRUCTIONS = `
- vendorDetails: vendor email, complete mailing address and phone exactly as printed, with null for absent details. Include ein only when explicitly labeled EIN or employer identification number (for example on a W-9); never use an SSN, bank account or routing number. Do not infer missing details.`
const clean = (v: unknown, max: number) => typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null
export const einDigits = (v: unknown) => typeof v === 'string' && /^(?:\d{9}|\d{2}-\d{7})$/.test(v.replace(/\s/g, '')) ? v.replace(/[\s-]/g, '') : null
export function normaliseVendorDetails(v: unknown): VendorDetails | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const d = v as Data, email = clean(d.email, 254)?.toLowerCase() ?? null
  return { email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null, address: clean(d.address, 500), phone: clean(d.phone, 60), ein: einDigits(d.ein) }
}
/** Persist identity evidence without returning a full EIN through receipt views. */
export async function vendorReadingColumns(details?: VendorDetails | null) {
  if (!details) return { read_vendor_details: null }
  const { ein, ...safe } = details
  return { read_vendor_details: JSON.stringify({ ...safe, einHash: ein ? await sha256(ein) : null, einLast4: ein?.slice(-4) ?? null }) }
}
export function storedVendorDetails(r: Data): VendorDetails {
  if (!r.read_vendor_details) return { email: null, address: null, phone: null }
  return JSON.parse(r.read_vendor_details)
}
