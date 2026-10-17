// Business setup, people and agents: owner-only work.
import { operatorAuth, runtimeBindings } from '../auth.server'
import { authority, who } from './access'
import { date, now, optionalText, requireThat, sha256, text, uid, Fault, type Data } from './core'
import { all, audit, changed, one, q, run } from './db'
import type { Command, Context } from './context'

const ENTITY_TYPES = ['sole-proprietorship', 'single-member-llc', 'multi-member-llc', 's-corporation', 'c-corporation', 'partnership']
const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')

export async function entity(db: D1Database) {
  return await one(db, 'SELECT * FROM pt_entity WHERE id = 1')
}

export async function requireEntity(db: D1Database) {
  const e = await entity(db)
  if (!e) throw new Fault(409, 'Set up the business first')
  return e
}

const saveEntity: Command = { need: 'owner', async run(c, b) {
  const current = await entity(c.db)
  const legal = text(b.legalName, 'Legal name', 200)
  const entityType = text(b.entityType, 'Entity type')
  requireThat(ENTITY_TYPES.includes(entityType), 'Choose an entity type')
  const state = text(b.state, 'State')
  requireThat(STATES.includes(state), 'Choose the state the business is organized in')
  const fy = Number(b.fiscalYearStart)
  requireThat(Number.isInteger(fy) && fy >= 1 && fy <= 12, 'Fiscal year start must be a month (1–12)')
  const taxMethod = text(b.taxMethod, 'Tax accounting method')
  requireThat(['cash', 'accrual', 'undeclared'].includes(taxMethod), 'Tax method is cash, accrual or undeclared (decided with your accountant)')
  const booksStart = date(b.booksStart, 'Books start date')
  const policies = optionalText(b.policies, 'Book and report policies', 5000)
  const revision = uid(), at = now()
  if (current) {
    requireThat(b.revision === current.revision, 'Business settings changed; reload', 409)
    requireThat(current.books_start === booksStart || !(await one(c.db, "SELECT 1 FROM pt_journal_entries WHERE status = 'posted' LIMIT 1")), 'Books start cannot move once entries are posted', 409)
  }
  await run(c.db, [authority(c.actor, 'owner'),
    current
      ? q('UPDATE pt_entity SET legal_name = ?, entity_type = ?, state = ?, fiscal_year_start = ?, tax_method = ?, policies = ?, books_start = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = 1 AND revision = ?', legal, entityType, state, fy, taxMethod, policies, booksStart, revision, c.actor.email, at, current.revision)
      : q("INSERT INTO pt_entity (id, legal_name, entity_type, state, currency, fiscal_year_start, book_basis, tax_method, policies, books_start, revision, updated_by, updated_at) VALUES (1, ?, ?, ?, 'USD', ?, 'accrual', ?, ?, ?, ?, ?, ?)", legal, entityType, state, fy, taxMethod, policies, booksStart, revision, c.actor.email, at),
    changed(),
    audit(who(c.actor), current ? 'entity.update' : 'entity.create', 'entity', '1', { legalName: legal, entityType, state, fiscalYearStart: fy, taxMethod })])
  return (await entity(c.db))!
} }

const saveMember: Command = { need: 'owner', async run(c, b) {
  const email = text(b.email, 'Email', 254).toLowerCase()
  requireThat(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email')
  const role = text(b.role, 'Role')
  requireThat(['bookkeeper', 'accountant', 'viewer'].includes(role), 'Role is bookkeeper, accountant or viewer')
  const flag = (v: unknown) => (v === true || v === 'on' || v === 'true' || v === 1) && role !== 'viewer' ? 1 : 0
  const row = { name: text(b.name, 'Name', 200), post: flag(b.canPost), lock: flag(b.canLock), reopen: flag(b.canReopen), active: b.active === false || b.active === 'false' ? 0 : 1 }
  // Editing someone's email moves that person to the new address: the old one no longer signs in to these books.
  const previous = b.previousEmail ? text(b.previousEmail, 'Previous email', 254).toLowerCase() : email
  if (previous !== email) {
    requireThat(await one(c.db, 'SELECT 1 FROM pt_members WHERE email = ?', previous), 'That person is no longer in People; reload', 404)
    requireThat(!(await one(c.db, 'SELECT 1 FROM pt_members WHERE email = ?', email)), `${email} is already in People`, 409)
    await run(c.db, [authority(c.actor, 'owner'),
      q('UPDATE pt_members SET email = ?, name = ?, role = ?, can_post = ?, can_lock = ?, can_reopen = ?, active = ?, revision = ? WHERE email = ?', email, row.name, role, row.post, row.lock, row.reopen, row.active, uid(), previous), changed(),
      audit(who(c.actor), 'member.save', 'member', email, { previousEmail: previous, role, canPost: !!row.post, canLock: !!row.lock, canReopen: !!row.reopen, active: !!row.active })])
    return (await one(c.db, 'SELECT * FROM pt_members WHERE email = ?', email))!
  }
  await run(c.db, [authority(c.actor, 'owner'),
    q('INSERT INTO pt_members (email, name, role, can_post, can_lock, can_reopen, active, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, can_post = excluded.can_post, can_lock = excluded.can_lock, can_reopen = excluded.can_reopen, active = excluded.active, revision = excluded.revision',
      email, row.name, role, row.post, row.lock, row.reopen, row.active, uid()),
    audit(who(c.actor), 'member.save', 'member', email, { role, canPost: !!row.post, canLock: !!row.lock, canReopen: !!row.reopen, active: !!row.active })])
  return (await one(c.db, 'SELECT * FROM pt_members WHERE email = ?', email))!
} }

const inviteMember: Command = { need: 'owner', async run(c, b) {
  const email = text(b.email, 'Email').toLowerCase()
  const member = await one(c.db, 'SELECT * FROM pt_members WHERE email = ? AND active = 1', email)
  requireThat(member, 'Add the person with a role before inviting them')
  try { await operatorAuth(runtimeBindings(c.env)).invite(c.request, { email, displayName: member.name, role: 'member', returnTo: '/app' }) }
  catch (error) {
    if ((error as { code?: string }).code === 'invitation_conflict') throw new Fault(409, `${member.name} already signs in to this Pantry with ${email}; no new invitation is needed`)
    throw error
  }
  await run(c.db, [authority(c.actor, 'owner'), audit(who(c.actor), 'member.invite', 'member', email)])
  // A run on this computer (or the demo) records the invitation but sends no email.
  const e = runtimeBindings(c.env)
  return { invited: email, name: member.name, emailed: !(e.MAIL_PROVIDER === 'development' || e.RER_DEMO === '1') }
} }

// The owner's own name and sign-in email. The email changes through sign-in, which asks for a fresh
// proof (on this computer the dev sign-in is enough; hosted, an email-link sign-in in the last ten minutes).
const STEP_UP = 'To change your sign-in email, sign out, sign in again with the emailed link, and change it within ten minutes.'
const saveOwner: Command = { need: 'owner', async run(c, b) {
  const name = text(b.name, 'Name', 200), email = text(b.email, 'Email', 254).toLowerCase()
  requireThat(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email')
  requireThat(!(await one(c.db, 'SELECT 1 FROM pt_members WHERE email = ?', email)), `${email} is already someone in People`, 409)
  if (email !== c.actor.email) {
    const auth = operatorAuth(runtimeBindings(c.env)) as unknown as { changeEmail?: (r: Request, i: Data) => Promise<unknown> }
    requireThat(auth.changeEmail, 'This installation cannot change sign-in emails', 409)
    try { await auth.changeEmail!(c.request, { email }) }
    catch (error) {
      const code = (error as { code?: string }).code
      if (code === 'step_up_required') throw new Fault(403, STEP_UP)
      if (code === 'email_in_use') throw new Fault(409, `${email} already signs in to this Pantry`)
      if (code === 'email_not_allowed') throw new Fault(400, `${email} is not allowed to sign in here`)
      throw error
    }
  }
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE oa_operators SET display_name = ? WHERE id = ?', name, c.actor.id), changed(),
    audit(who(c.actor), 'owner.save', 'owner', c.actor.id, { name, ...(email !== c.actor.email ? { previousEmail: c.actor.email, email } : {}) })])
  return { name, email }
} }

const createAgent: Command = { need: 'owner', async run(c, b) {
  const name = text(b.name, 'Agent name', 80)
  requireThat(/^[A-Za-z0-9 ._-]+$/.test(name), 'Agent name uses letters, numbers, spaces, dots, dashes')
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = 'pantry_agent_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const id = uid()
  await run(c.db, [authority(c.actor, 'owner'),
    q('INSERT INTO pt_agents (id, name, token_hash, created_by, created_at, active, revision) VALUES (?, ?, ?, ?, ?, 1, ?)', id, name, await sha256(token), c.actor.email, now(), uid()),
    audit(who(c.actor), 'agent.create', 'agent', id, { name })])
  // The token is shown once; only its hash is stored.
  return { id, name, token }
} }

const deactivateAgent: Command = { need: 'owner', async run(c, b) {
  const id = text(b.id, 'Agent')
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_agents SET active = 0, revision = ? WHERE id = ? AND active = 1', uid(), id), changed(), audit(who(c.actor), 'agent.deactivate', 'agent', id)])
  return { id }
} }

export const settingsCommands: Record<string, Command> = {
  'entity.save': saveEntity,
  'member.save': saveMember,
  'member.invite': inviteMember,
  'owner.save': saveOwner,
  'agent.create': createAgent,
  'agent.deactivate': deactivateAgent,
}

export async function settingsView(c: Context): Promise<Data> {
  const owner = c.actor.kind === 'person' && c.actor.role === 'owner'
  return {
    entity: await entity(c.db),
    members: owner ? await all(c.db, 'SELECT email, name, role, can_post, can_lock, can_reopen, active FROM pt_members ORDER BY email') : [],
    agents: owner ? await all(c.db, 'SELECT id, name, created_by, created_at, active FROM pt_agents ORDER BY created_at') : [],
    choices: { entityTypes: ENTITY_TYPES, states: STATES },
    // The owner address this install was set up with, which rer deploy gives a hosted Pantry unless .env.pantry names one.
    setupOwner: owner ? String(runtimeBindings(c.env).OWNER_EMAIL ?? '').toLowerCase() : null,
  }
}
