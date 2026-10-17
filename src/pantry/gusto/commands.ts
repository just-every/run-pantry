// Connecting Gusto: the owner starts Gusto's sign-in from Settings, chooses the
// company there, and comes back to Pantry, which keeps the tokens sealed and
// adds the payroll accounts. The owner then says which bank account Gusto
// debits and from when payrolls post; Pantry posts each processed payroll.
import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { authority, must, person, who } from '../access'
import { date, Fault, now, requireThat, text, uid } from '../core'
import { audit, changed, one, q, run, type Sql } from '../db'
import { accountInsert } from '../accounts'
import { nextCode } from '../stripe'
import { seal } from '../feeds/vault'
import type { Command, Context } from '../context'
import { availability, gusto, GustoError } from './client'
import { gustoSettings, payrollsView, syncPayrolls } from './payrolls'

const STATE_MS = 10 * 60_000

const start: Command = { need: 'owner', async run(c) {
  const client = gusto(c.env), state = uid()
  await run(c.db, [authority(c.actor, 'owner'), q('DELETE FROM pt_gusto_states WHERE started_at < ?', new Date(Date.now() - STATE_MS).toISOString()),
    q('INSERT INTO pt_gusto_states (state, started_by, started_at) VALUES (?, ?, ?)', state, c.actor.email, now())])
  return { url: client.authorizeUrl(state) }
} }

const configure: Command = { need: 'owner', async run(c, b) {
  const g = await gustoSettings(c.db)
  requireThat(g, 'Connect Gusto first', 409)
  const bank = await one(c.db, "SELECT b.* FROM pt_bank_accounts b LEFT JOIN pt_stripe s ON s.bank_account_id = b.id WHERE b.id = ? AND s.id IS NULL", text(b.bankAccountId, 'Bank account Gusto debits'))
  requireThat(bank, 'Choose the bank account Gusto debits for payroll')
  const from = date(b.from, 'Post payrolls paid from')
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_gusto SET bank_account_id = ?, payrolls_from = ?, revision = ? WHERE id = 1', bank.id, from, uid()), changed(),
    audit(who(c.actor), 'gusto.settings', 'gusto', '1', { bankAccount: bank.name, from })])
  return { sync: availability(c.env).available ? await syncPayrolls(c.env, c.db) : null, gusto: await gustoView(c) }
} }

const syncNow: Command = { need: 'record', async run(c) {
  gusto(c.env)
  const g = await gustoSettings(c.db)
  requireThat(g?.bank_account_id, 'Choose the bank account Gusto debits first', 409)
  const sync = await syncPayrolls(c.env, c.db)
  requireThat(sync.claimed, 'Payrolls are already being read; try again in a minute', 409)
  return { sync, gusto: await gustoView(c) }
} }

const disconnect: Command = { need: 'owner', async run(c) {
  const g = await gustoSettings(c.db)
  requireThat(g, 'Gusto is not connected', 409)
  // Posted payrolls stay; Pantry forgets the tokens.
  await run(c.db, [authority(c.actor, 'owner'), q('DELETE FROM pt_gusto WHERE id = 1'), changed(), audit(who(c.actor), 'gusto.disconnect', 'gusto', '1', { company: g.company_name })])
  return { gusto: await gustoView(c) }
} }

export const gustoCommands: Record<string, Command> = {
  'gusto.connect': start,
  'gusto.settings': configure,
  'gusto.sync': syncNow,
  'gusto.disconnect': disconnect,
}

/** The payroll accounts, reusing those a previous connection made. */
async function payrollAccounts(db: D1Database, previous: Record<string, string> | null) {
  const statements: Sql[] = [], ids: Record<string, string> = {}
  const wanted: [string, number, string, 'expense' | 'liability', string][] = [
    ['wages_account_id', 6600, 'Wages and salaries', 'expense', 'Gross pay from Gusto payrolls'],
    ['taxes_account_id', 6610, 'Payroll taxes', 'expense', "The employer's share of payroll taxes"],
    ['benefits_account_id', 6620, 'Employee benefits', 'expense', 'Company contributions to employee benefits'],
    ['reimbursements_account_id', 6630, 'Employee reimbursements', 'expense', 'Expenses repaid to employees through payroll'],
    ['liabilities_account_id', 2300, 'Payroll liabilities', 'liability', 'Paper checks, deductions and benefits owed after a payroll'],
  ]
  const codes = new Set<string>()
  for (const [field, from, name, type, description] of wanted) {
    const kept = previous?.[field] && await one(db, 'SELECT id FROM pt_accounts WHERE id = ?', previous[field])
    if (kept) { ids[field] = previous![field]; continue }
    let code = await nextCode(db, from)
    while (codes.has(code)) code = String(Number(code) + 1)
    codes.add(code)
    ids[field] = uid()
    statements.push(accountInsert(ids[field], { code, name, type, subtype: 'other', description }))
  }
  return { ids, statements }
}

const back = (path: string) => new Response(null, { status: 303, headers: { location: path, 'cache-control': 'no-store' } })

/** Gusto sends the owner back here with a code for the company they chose. */
export function gustoRoutes(api: Hono<{ Bindings: Bindings }>) {
  api.get('/api/pantry/gusto/callback', async c => {
    const actor = await person(c.req.raw, c.env)
    must(actor, 'owner')
    const db = c.env.DB, state = c.req.query('state') ?? '', fail = (message: string) => back(`/app/settings?gusto_error=${encodeURIComponent(message)}#payroll`)
    const pending = await one(db, 'SELECT * FROM pt_gusto_states WHERE state = ?', state)
    await run(db, [q('DELETE FROM pt_gusto_states WHERE state = ?', state)])
    if (!pending || pending.started_by !== actor.email || Date.parse(pending.started_at) < Date.now() - STATE_MS) return fail('That Gusto sign-in expired or was not started here; connect Gusto again.')
    if (c.req.query('error')) return fail(`Gusto did not connect: ${c.req.query('error_description') ?? c.req.query('error')}`)
    try {
      const client = gusto(c.env)
      const tokens = await client.exchange(text(c.req.query('code'), 'Authorization code', 500))
      const info = await client.tokenInfo(tokens.access_token)
      requireThat(info.resource?.type === 'Company' && info.resource.uuid, 'Gusto did not say which company was connected; connect Gusto again and choose a company.', 409)
      const company = await client.company(tokens.access_token, info.resource.uuid)
      const previous = await gustoSettings(db), e = await one(db, 'SELECT books_start FROM pt_entity WHERE id = 1')
      const accounts = await payrollAccounts(db, previous)
      // With one ordinary bank account, that is the one Gusto debits; otherwise the owner chooses.
      const banks = await (db.prepare('SELECT b.id FROM pt_bank_accounts b LEFT JOIN pt_stripe s ON s.bank_account_id = b.id WHERE s.id IS NULL').all<{ id: string }>()).then(r => r.results)
      const bankId = previous?.bank_account_id ?? (banks.length === 1 ? banks[0].id : null)
      const name = company.trade_name || company.name || company.uuid, a = accounts.ids
      await run(db, [authority(actor, 'owner'), ...accounts.statements,
        q(`INSERT INTO pt_gusto (id, company_uuid, company_name, access_sealed, refresh_sealed, access_expires_at, bank_account_id, wages_account_id, taxes_account_id, benefits_account_id, reimbursements_account_id, liabilities_account_id, payrolls_from, connected_by, connected_at, revision)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET company_uuid = excluded.company_uuid, company_name = excluded.company_name, access_sealed = excluded.access_sealed, refresh_sealed = excluded.refresh_sealed, access_expires_at = excluded.access_expires_at,
            wages_account_id = excluded.wages_account_id, taxes_account_id = excluded.taxes_account_id, benefits_account_id = excluded.benefits_account_id, reimbursements_account_id = excluded.reimbursements_account_id, liabilities_account_id = excluded.liabilities_account_id, sync_error = '', connected_by = excluded.connected_by, connected_at = excluded.connected_at, revision = excluded.revision`,
          company.uuid, name, await seal(c.env.SESSION_SECRET, tokens.access_token), await seal(c.env.SESSION_SECRET, tokens.refresh_token), new Date(Date.now() + tokens.expires_in * 1000).toISOString(), bankId,
          a.wages_account_id, a.taxes_account_id, a.benefits_account_id, a.reimbursements_account_id, a.liabilities_account_id, previous?.payrolls_from ?? e?.books_start ?? now().slice(0, 10), actor.email, now(), uid()),
        audit(who(actor), 'gusto.connect', 'gusto', '1', { company: name, companyUuid: company.uuid, environment: client.environment })])
      // The first read runs before the owner lands back on Settings, so the payrolls are there to see.
      if (bankId) await syncPayrolls(c.env, db)
      return back('/app/settings?gusto=connected#payroll')
    } catch (error) {
      if (error instanceof Fault || error instanceof GustoError) return fail(error.message)
      throw error
    }
  })
}

export async function gustoView(c: Context) {
  const a = availability(c.env), g = await gustoSettings(c.db)
  const name = async (id: string) => one(c.db, 'SELECT code, name FROM pt_accounts WHERE id = ?', id)
  return {
    availability: a.available ? { available: true, environment: a.environment, redirectUri: a.redirectUri } : a,
    connected: g ? {
      company: g.company_name, companyUuid: g.company_uuid, from: g.payrolls_from, syncedAt: g.synced_at, error: g.sync_error, connectedBy: g.connected_by, connectedAt: g.connected_at,
      bank: g.bank_account_id ? await one(c.db, 'SELECT id, name, number_last4 FROM pt_bank_accounts WHERE id = ?', g.bank_account_id) : null,
      accounts: { wages: await name(g.wages_account_id), taxes: await name(g.taxes_account_id), liabilities: await name(g.liabilities_account_id) },
    } : null,
    payrolls: await payrollsView(c.db),
  }
}
