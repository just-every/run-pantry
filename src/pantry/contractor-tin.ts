import type { Bindings } from '../auth.server'
import { requireThat, sha256 } from './core'
import { all } from './db'
import { seal, unseal } from './seal'

/** Separate purpose per vendor prevents moving an envelope between identities. */
export async function sealTin(env: Bindings, contactId: string, tin: string) {
  requireThat(env.SESSION_SECRET?.length >= 32, 'The installation encryption secret is unavailable', 503)
  return { tin: await seal(env.SESSION_SECRET, `contractor-tin:${contactId}`, tin), last4: tin.slice(-4), hash: await seal(env.SESSION_SECRET, `contractor-ein-match:${contactId}`, await sha256(tin)) }
}

export async function openTin(env: Bindings, contactId: string, sealed: string) {
  const tin = await unseal(env.SESSION_SECRET, `contractor-tin:${contactId}`, sealed)
  requireThat(tin && /^\d{9}$/.test(tin), 'The tax identity cannot be opened with this installation secret. Re-enter the TIN from the W-9 before filing.', 409)
  return tin
}

/** Receipt matching opens only the encrypted equality evidence, never the TIN. */
export async function matchesTin(env: Bindings, contactId: string, sealedHash: string, receiptHash: string) {
  return await unseal(env.SESSION_SECRET, `contractor-ein-match:${contactId}`, sealedHash) === receiptHash
}

/** Upgrade existing installations before any data response or scheduled work.
 * Each batch clears legacy digits atomically; concurrent requests compare the
 * exact previous value, so a save or erasure always wins over an old upgrade.
 */
export async function upgradeTins(env: Bindings) {
  for (;;) {
    const rows = await all(env.DB, "SELECT contact_id,tin FROM pt_contractor_tax WHERE length(tin)=9 AND tin NOT GLOB '*[^0-9]*' LIMIT 40")
    if (!rows.length) return
    const statements = await Promise.all(rows.map(async row => {
      const sealed = await sealTin(env, row.contact_id, row.tin)
      return env.DB.prepare('UPDATE pt_contractor_tax SET tin=?,tin_last4=?,tin_hash=? WHERE contact_id=? AND tin=? AND erased_at IS NULL').bind(sealed.tin, sealed.last4, sealed.hash, row.contact_id, row.tin)
    }))
    await env.DB.batch(statements)
  }
}
