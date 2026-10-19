// Confirm identity separately from attaching a receipt. This command creates a
// contact only when requested and never edits/merges an existing contact.
import { authority, who } from '../access'
import { now, optionalText, requireThat, text, uid } from '../core'
import { audit, changed, guard, one, q, run, type Sql } from '../db'
import type { Command } from '../context'
import { receiptVendorProposal, vendorNameKey } from './vendor-match'
import { storedVendorDetails } from './vendor-details'
import { vendorProfile } from './vendor-profile'

const confirm: Command = { need: 'record', async run(c, b) {
  requireThat(c.actor.kind === 'person', 'A person confirms vendor identity', 403)
  requireThat(b.confirm === true || b.confirm === 'true' || b.confirm === 'on', 'Confirm the vendor identity before saving')
  const r = await one(c.db, "SELECT * FROM pt_receipts WHERE id = ? AND status = 'review'", text(b.id, 'Receipt'))
  requireThat(r, 'Receipt not found or already decided', 404)
  requireThat(r.revision === b.revision, 'This receipt changed; reload', 409)
  const proposal = await receiptVendorProposal(c.db, r), details = storedVendorDetails(r)
  const statements: Sql[] = [authority(c.actor, 'record'), guard("EXISTS (SELECT 1 FROM pt_receipts WHERE id = ? AND revision = ? AND status = 'review')", r.id, r.revision)]
  let vendor
  if (b.vendorId) {
    vendor = await one(c.db, "SELECT * FROM pt_contacts WHERE id = ? AND kind = 'vendor' AND active = 1", text(b.vendorId, 'Vendor'))
    requireThat(vendor, 'Choose an active vendor', 404)
    requireThat(vendor.revision === b.vendorRevision, 'This vendor changed; reload', 409)
    statements.push(guard("EXISTS (SELECT 1 FROM pt_contacts WHERE id = ? AND revision = ? AND kind = 'vendor' AND active = 1)", vendor.id, vendor.revision))
  } else {
    requireThat(b.create === true || b.create === 'true', 'Choose an existing vendor or accept the proposed new vendor')
    const reason = optionalText(b.newVendorReason, 'Reason for a separate vendor', 300)
    requireThat(!proposal.candidates.length || reason, 'Possible existing vendor: choose it, or explain why this is a separate vendor', 409)
    const name = text(b.name ?? proposal.proposed.name, 'Vendor name', 200)
    const email = optionalText(b.email ?? proposal.proposed.email, 'Email', 254).toLowerCase()
    requireThat(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email')
    const profile = await vendorProfile(c.db, { ...b, address: b.address ?? proposal.proposed.address, phone: b.phone ?? proposal.proposed.phone, defaultAccountId: b.defaultAccountId ?? r.read_account_id })
    const terms = b.termsDays === undefined || b.termsDays === '' ? 30 : Number(b.termsDays)
    requireThat(Number.isInteger(terms) && terms >= 0 && terms <= 365, 'Payment terms are 0–365 days')
    vendor = { id: uid(), name, email, revision: uid(), terms_days: terms, is_1099: profile.is1099, default_account_id: profile.accountId, default_class: profile.className }
    statements.push(q(`INSERT INTO pt_contacts (id, kind, name, email, terms_days, external_ref, bank_reference, active, revision, address, phone, default_account_id, default_class, is_1099, vendor_ein_hash)
      VALUES (?, 'vendor', ?, ?, ?, '', '', 1, ?, ?, ?, ?, ?, ?, ?)`, vendor.id, name, email, terms, vendor.revision, profile.address, profile.phone, profile.accountId, profile.className, profile.is1099, profile.einHash || details.einHash || ''),
    audit(who(c.actor), 'contact.create-from-receipt', 'vendor', vendor.id, { receiptId: r.id, name, separateVendorReason: reason || undefined }))
  }
  // Only the observed name is learned. Domain/address/phone evidence never
  // becomes permission to modify a contact or payment instruction.
  const alias = r.read_vendor || r.vendor || ''
  if (alias && vendorNameKey(alias) !== vendorNameKey(vendor.name)) statements.push(q(`INSERT INTO pt_vendor_aliases (vendor_id, alias_key, alias, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (vendor_id, alias_key) DO NOTHING`, vendor.id, vendorNameKey(alias), alias, c.actor.email, now()))
  statements.push(q(`UPDATE pt_receipts SET vendor_id = ?, vendor = ?, account_id = ?, vendor_terms_days = ?, vendor_is_1099 = ?, vendor_class = ?, vendor_confirmed_by = ?, vendor_confirmed_at = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'review'`,
    vendor.id, vendor.name, vendor.default_account_id ?? r.account_id ?? r.read_account_id, vendor.terms_days, vendor.is_1099, vendor.default_class, c.actor.email, now(), uid(), r.id, r.revision), changed(),
  audit(who(c.actor), 'receipt.vendor-confirm', 'receipt', r.id, { vendorId: vendor.id, created: !b.vendorId, alias: alias || undefined, einLast4: details.einLast4 ?? undefined }))
  await run(c.db, statements)
  const saved = (await one(c.db, 'SELECT * FROM pt_receipts WHERE id = ?', r.id))!
  return { id: r.id, revision: saved.revision, vendorId: vendor.id, vendorProposal: await receiptVendorProposal(c.db, saved) }
} }

export const receiptVendorCommands: Record<string, Command> = { 'receipt.vendor-confirm': confirm }
