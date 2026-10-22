// Identity evidence proposes contacts; only a person's confirmation retains an alias.
import { all } from '../db'
import { sha256, type Data } from '../core'
import { storedVendorDetails } from './vendor-details'

export const vendorNameKey = (value: string | null | undefined) => (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const nameVariant = (v: string) => vendorNameKey(v).replace(/^(?:the )/, '').replace(/\s+(?:store\s*)?\d+$/, '').replace(/\s+(?:pro|inc|incorporated|llc|ltd|corp|corporation)$/, '').trim()
const phoneKey = (v: string | null) => { const digits = (v ?? '').replace(/\D/g, ''); return digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits.length >= 7 ? digits : '' }
const STREET_WORDS: Record<string, string> = { street: 'st', road: 'rd', avenue: 'ave', boulevard: 'blvd', drive: 'dr', suite: 'ste' }
const addressKey = (v: string | null) => vendorNameKey(v).replace(/\b(street|road|avenue|boulevard|drive|suite)\b/g, x => STREET_WORDS[x]!)
const PUBLIC_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'aol.com', 'icloud.com', 'proton.me', 'protonmail.com'])
const domain = (v: string | null) => { const d = /@([a-z0-9.-]+\.[a-z]{2,})\s*>?$/i.exec(v ?? '')?.[1].toLowerCase() ?? ''; return PUBLIC_MAIL.has(d) ? '' : d }
export function vendorDefaults(v: Data) {
  return { accountId: v.default_account_id ?? null, termsDays: v.terms_days, is1099: !!v.is_1099, className: v.default_class ?? '',locationName:v.default_location??'',projectName:v.default_project??'' }
}
function publicVendor(v: Data) { return { id: v.id, name: v.name, email: v.email, address: v.address, phone: v.phone, revision: v.revision, defaults: vendorDefaults(v) } }

/** Conflicting identities remain choices, even if one has a stronger signal. */
export async function receiptVendorProposal(db: D1Database, r: Data) {
  const details = storedVendorDetails(r), name = r.vendor ?? r.read_vendor ?? ''
  const [vendors, aliases] = await Promise.all([
    all(db, `SELECT c.*, t.tin, t.tin_kind, t.address AS tax_address, t.city AS tax_city, t.state AS tax_state, t.zip AS tax_zip
      FROM pt_contacts c LEFT JOIN pt_contractor_tax t ON t.contact_id = c.id WHERE c.kind = 'vendor' AND c.active = 1 ORDER BY c.name, c.id`),
    all(db, 'SELECT vendor_id, alias_key FROM pt_vendor_aliases'),
  ])
  const candidates: Data[] = []
  const readDomains = [domain(details.email), domain(r.sender)].filter(Boolean)
  for (const v of vendors) {
    const reasons: string[] = [], key = vendorNameKey(name), variant = nameVariant(name)
    if (key && key === vendorNameKey(v.name)) reasons.push('name')
    else if (key && aliases.some(a => a.vendor_id === v.id && a.alias_key === key)) reasons.push('confirmed alias')
    else if (variant.length >= 5 && variant === nameVariant(v.name)) reasons.push('name variant')
    if (readDomains.includes(domain(v.email)) && domain(v.email)) reasons.push('email domain')
    const address = addressKey(details.address)
    const taxAddress = [v.tax_address, v.tax_city, v.tax_state, v.tax_zip].filter(Boolean).join(' ')
    if (address.length >= 10 && [addressKey(v.address), addressKey(taxAddress)].includes(address)) reasons.push('address')
    if (phoneKey(details.phone) && phoneKey(details.phone) === phoneKey(v.phone)) reasons.push('phone')
    if (details.einHash && (details.einHash === v.vendor_ein_hash || (v.tin_kind === 'ein' && v.tin && details.einHash === await sha256(v.tin)))) reasons.push('EIN on W-9')
    if (reasons.length) candidates.push({ ...publicVendor(v), reasons })
  }
  const confirmed = r.vendor_id ? vendors.find(v => v.id === r.vendor_id) : null
  const matched = candidates.length === 1 ? candidates[0] : null
  return {
    state: confirmed ? 'confirmed' : candidates.length > 1 ? 'ambiguous' : matched ? 'matched' : 'new',
    matched, confirmed: confirmed ? publicVendor(confirmed) : null, candidates,
    // Any full EIN was discarded on intake. A person can inspect the original W-9.
    proposed: { name, email: details.email ?? '', address: details.address ?? '', phone: details.phone ?? '', einLast4: details.einLast4 ?? null },
    defaults: confirmed ? { accountId: r.account_id ?? confirmed.default_account_id ?? null, termsDays: r.vendor_terms_days ?? confirmed.terms_days, is1099: r.vendor_is_1099 === null || r.vendor_is_1099 === undefined ? !!confirmed.is_1099 : !!r.vendor_is_1099, className: r.class_name||r.vendor_class||confirmed.default_class||'',locationName:r.location_name||confirmed.default_location||'',projectName:r.project_name||confirmed.default_project||'' } : matched?.defaults ?? null,
  }
}
