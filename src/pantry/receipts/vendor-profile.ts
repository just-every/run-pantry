import { dimensionRefusal } from '../dimensions'
// Shared validation for deliberate contact edits and accepted new-vendor proposals.
import { optionalText, requireThat, sha256, type Data } from '../core'
import { one } from '../db'
import { einDigits } from './vendor-details'

export async function vendorProfile(db: D1Database, b: Data, current?: Data | null) {
  const address = b.address === undefined ? current?.address ?? '' : optionalText(b.address, 'Address', 500)
  const phone = b.phone === undefined ? current?.phone ?? '' : optionalText(b.phone, 'Phone', 60)
  const accountId = b.defaultAccountId === undefined ? current?.default_account_id ?? null : optionalText(b.defaultAccountId, 'Default account', 100) || null
  if (accountId) requireThat(await one(db, "SELECT 1 FROM pt_accounts WHERE id = ? AND active = 1 AND subtype NOT IN ('bank', 'receivable', 'payable')", accountId), 'Choose an active expense or other default account')
  const className = b.defaultClass === undefined ? current?.default_class ?? '' : optionalText(b.defaultClass, 'Default class', 100)
  const locationName=b.defaultLocation===undefined?current?.default_location??'':optionalText(b.defaultLocation,'Default location',100)
  const projectName=b.defaultProject===undefined?current?.default_project??'':optionalText(b.defaultProject,'Default project',100)
  const refusal=await dimensionRefusal(db,[],{className,locationName,projectName});requireThat(!refusal,refusal??'Invalid default dimensions',409)
  const is1099 = b.is1099 === undefined ? current?.is_1099 ?? 0 : b.is1099 === true || b.is1099 === 'true' || b.is1099 === 'on' ? 1 : 0
  requireThat(b.is1099 === undefined || [true, false, 'true', 'false', 'on', 'off', ''].includes(b.is1099), 'Choose whether this is a 1099 vendor')
  const raw = optionalText(b.ein, 'EIN', 20)
  requireThat(!raw || einDigits(raw), 'An EIN is nine digits')
  const einHash = raw ? await sha256(einDigits(raw)!) : current?.vendor_ein_hash ?? ''
  return { address, phone, accountId, className,locationName,projectName, is1099, einHash }
}
