import { dimensionTags } from '../dimensions'
// Gusto payrolls, posted by themselves. Pantry reads each processed payroll
// with its totals from the connected company, posts it as one balanced entry
// on its check date, and matches the entry's bank lines to Gusto's debit(s)
// when they arrive. A payroll is posted once however often it is read again.
import type { Bindings } from '../../auth.server'
import { pantry } from '../access'
import { addDays, Fault, now, uid, usd, type Data } from '../core'
import { all, audit, changed, one, q, run, type Sql } from '../db'
import { entryStatements } from '../journal'
import { entryMatch, matchEntry } from '../provider-match'
import { open, seal } from '../feeds/vault'
import { availability, gusto, GustoError, type Payroll } from './client'
import { payrollEntry, type PayrollEntry, type Role } from './entry'

const EVERY_MS = 6 * 3600_000, LEASE_MS = 5 * 60_000
const today = () => new Date().toISOString().slice(0, 10)

export async function gustoSettings(db: D1Database):Promise<Data|null> {
  const row=await one(db, 'SELECT * FROM pt_gusto WHERE id = 1')
  return row?{...row,dimension_mapping:Object.fromEntries((await all(db,'SELECT * FROM pt_payroll_dimensions')).map(r=>[r.role,dimensionTags(r)]))}:null
}

/** A working access token: the stored one, or a refreshed pair saved before it is used. */
export async function accessToken(env: Bindings, db: D1Database, g: Data) {
  if (Date.parse(g.access_expires_at) > Date.now() + 60_000) {
    const token = await open(env.SESSION_SECRET, g.access_sealed)
    if (token) return token
  }
  const refresh = await open(env.SESSION_SECRET, g.refresh_sealed)
  if (!refresh) throw new Fault(409, 'This Gusto connection was made by another installation; connect Gusto again here.')
  let tokens
  try { tokens = await gusto(env).refresh(refresh) } catch (e) {
    if (e instanceof GustoError && e.status >= 400 && e.status < 500) throw new Fault(409, 'Gusto no longer accepts this connection (it was revoked or expired); connect Gusto again.')
    throw e
  }
  // The old refresh token is spent: the new pair is stored first, guarded on the one it replaced.
  await run(db, [q('UPDATE pt_gusto SET access_sealed = ?, refresh_sealed = ?, access_expires_at = ? WHERE id = 1 AND refresh_sealed = ?',
    await seal(env.SESSION_SECRET, tokens.access_token), await seal(env.SESSION_SECRET, tokens.refresh_token), new Date(Date.now() + tokens.expires_in * 1000).toISOString(), g.refresh_sealed), changed()])
  return tokens.access_token
}

const uuidOf = (p: Payroll) => String(p.payroll_uuid ?? p.uuid)

function bookStatements(g: Data, p: Payroll, e: PayrollEntry, entryId: string, bankLedger: string): Sql[] {
  const account: Record<Role, string> = { wages: g.wages_account_id, taxes: g.taxes_account_id, benefits: g.benefits_account_id, reimbursements: g.reimbursements_account_id, liabilities: g.liabilities_account_id, bank: bankLedger }
  const period = p.pay_period?.start_date && p.pay_period?.end_date ? ` for ${p.pay_period.start_date} to ${p.pay_period.end_date}` : ''
  const by = pantry('gusto').email
  return entryStatements({ id: entryId, date: p.check_date, memo: `Gusto ${p.off_cycle ? 'off-cycle ' : ''}payroll paid ${p.check_date}${period}`, sourceKind: 'bank', sourceId: uuidOf(p), preparedBy: by, preparedKind: 'import',
    lines: e.lines.map(l => ({ ...g.dimension_mapping?.[l.role],accountId: account[l.role], debit: Math.max(l.signed, 0), credit: Math.max(-l.signed, 0), memo: l.memo })) }, by)
}

const row = (p: Payroll, e: PayrollEntry, status: 'booked' | 'held', reason: string, entryId: string | null) =>
  q(`INSERT INTO pt_gusto_payrolls (uuid, check_date, period_start, period_end, off_cycle, gross_cents, employer_tax_cents, withheld_cents, net_cents, debit_cents, status, reason, entry_id, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (uuid) DO UPDATE SET check_date = excluded.check_date, gross_cents = excluded.gross_cents, employer_tax_cents = excluded.employer_tax_cents, withheld_cents = excluded.withheld_cents, net_cents = excluded.net_cents, debit_cents = excluded.debit_cents, status = excluded.status, reason = excluded.reason, entry_id = excluded.entry_id, read_at = excluded.read_at
    WHERE pt_gusto_payrolls.status <> 'booked'`,
    uuidOf(p), p.check_date, p.pay_period?.start_date ?? null, p.pay_period?.end_date ?? null, p.off_cycle ? 1 : 0, e.gross, e.employerTaxes, e.withheld, e.net, e.debit, status, reason, entryId, now())

/** Processed payrolls since `from`, read in windows Gusto allows (a year at most each). */
async function processedPayrolls(env: Bindings, token: string, company: string, from: string) {
  const client = gusto(env), out: Payroll[] = []
  // Gusto filters on the pay period, which starts before the check date.
  for (let start = addDays(from, -45); start <= today(); start = addDays(start, 365)) {
    const end = [addDays(start, 364), today()].sort()[0]
    for (let page = 1; page <= 20; page++) {
      const list = await client.payrolls(token, company, start, end, page)
      out.push(...list)
      if (list.length < 100) break
    }
  }
  return out
}

/** Read processed payrolls and post each one not yet posted. One reader at a time. */
export async function syncPayrolls(env: Bindings, db: D1Database) {
  const claim = await db.prepare('UPDATE pt_gusto SET claim_until = ? WHERE id = 1 AND bank_account_id IS NOT NULL AND (claim_until IS NULL OR claim_until < ?)').bind(new Date(Date.now() + LEASE_MS).toISOString(), now()).run()
  if (claim.meta.changes !== 1) return { claimed: false }
  const counts = { read: 0, booked: 0, held: 0, matched: 0 }
  let error = ''
  try {
    const g = (await gustoSettings(db))!, token = await accessToken(env, db, g)
    const bank = (await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', g.bank_account_id))!
    const booked = new Set((await all<{ uuid: string }>(db, "SELECT uuid FROM pt_gusto_payrolls WHERE status = 'booked'")).map(r => r.uuid))
    const seen = new Set<string>()
    const payrolls = (await processedPayrolls(env, token, g.company_uuid, g.payrolls_from))
      .filter(p => p.processed && !p.external && p.check_date >= g.payrolls_from && !booked.has(uuidOf(p)) && !seen.has(uuidOf(p)) && seen.add(uuidOf(p)))
      .sort((a, b) => a.check_date.localeCompare(b.check_date))
    for (const p of payrolls) {
      counts.read++
      const e = payrollEntry(p.totals)
      if (!e.ok) { await run(db, [row(p, e, 'held', e.reason, null)]); counts.held++; continue }
      const entryId = uid()
      try {
        await run(db, [...bookStatements(g, p, e, entryId, bank.account_id), row(p, e, 'booked', '', entryId), changed(),
          audit(pantry('gusto'), 'gusto.payroll', 'gusto-payroll', uuidOf(p), { checkDate: p.check_date, gross: e.gross, employerTaxes: e.employerTaxes, withheld: e.withheld, net: e.net, debit: e.debit })])
        counts.booked++
      } catch (x) {
        if (!(x instanceof Fault)) throw x
        if ((await one(db, 'SELECT status FROM pt_gusto_payrolls WHERE uuid = ?', uuidOf(p)))?.status === 'booked') continue
        await run(db, [row(p, e, 'held', x.message, null)]); counts.held++
      }
    }
    counts.matched = await matchPayrolls(db)
  } catch (e) {
    error = e instanceof Fault || e instanceof GustoError ? e.message : String((e as Error)?.message ?? e)
    if (!(e instanceof Fault || e instanceof GustoError)) console.error('Pantry Gusto payrolls failed:', e)
  }
  await run(db, [q('UPDATE pt_gusto SET synced_at = ?, sync_error = ?, claim_until = NULL WHERE id = 1', now(), error)])
  return { claimed: true, ...counts, error }
}

/** Posted payrolls whose bank debits are not matched yet, matched where one set of lines fits. */
export async function matchPayrolls(db: D1Database) {
  const g = await one(db, 'SELECT bank_account_id FROM pt_gusto WHERE id = 1')
  if (!g?.bank_account_id) return 0
  const open_ = await all(db, `SELECT p.uuid, p.check_date, p.debit_cents, p.entry_id FROM pt_gusto_payrolls p WHERE p.status = 'booked' AND p.check_date >= ?
    AND NOT EXISTS (SELECT 1 FROM pt_journal_lines l JOIN pt_match_postings m ON m.journal_line_id = l.id WHERE l.entry_id = p.entry_id)`, addDays(today(), -120))
  let matched = 0
  for (const p of open_) if (await matchEntry(db, { entryId: p.entry_id, bankAccountId: g.bank_account_id, day: p.check_date, before: 6, after: 2, hint: /gusto/i, note: `Matched automatically: Gusto payroll paid ${p.check_date}, ${usd(p.debit_cents)} debited` })) matched++
  return matched
}

/** Due work: read payrolls every few hours. */
export async function syncDuePayrolls(env: Bindings, db: D1Database) {
  if (!availability(env).available) return
  const g = await one(db, 'SELECT bank_account_id, synced_at FROM pt_gusto WHERE id = 1')
  if (!g?.bank_account_id || (g.synced_at && Date.parse(g.synced_at) > Date.now() - EVERY_MS)) return
  await syncPayrolls(env, db)
}

export async function payrollsView(db: D1Database) {
  const rows = await all(db, 'SELECT * FROM pt_gusto_payrolls ORDER BY check_date DESC, uuid LIMIT 50')
  return Promise.all(rows.map(async r => ({ ...r, match: await entryMatch(db, r.entry_id) })))
}
