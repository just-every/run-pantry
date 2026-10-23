import { Hono, type Context as HonoContext } from 'hono'
import type { Bindings } from '../../auth.server'
import { authority, type Integration } from '../access'
import type { Context } from '../context'
import { date, Fault, now, requireThat, uid, type Data } from '../core'
import { all, one, run } from '../db'
import { documentFile } from '../documents'
import { invoice } from '../invoices'
import { entry } from '../journal'
import { bill } from '../payables'
import { vendorCredit, prepareVendorCredit, prepareVendorCreditAllocation } from '../vendor-credits'
import { FINANCIAL_REPORTS, readReport } from '../report-reader'
import { reportBasis } from '../basis'
import { identify } from './credentials'
import { integrationOpenApi } from './openapi'
import { registerRecordReads } from './resources'
import { integrationContact as contact, nativeRecord } from './resources/native'
import { integrationBudget } from './rate-limit'
import { idempotent, type Prepared } from './idempotency'
import { payment } from './payments'
import { prepareBill, prepareContact, prepareDocument, prepareInvoice, prepareJournal, preparePayment, prepareReadiness } from './postings'

type Env = { Bindings: Bindings; Variables: { integration: Integration & { scopes: string[] } } }
type C = HonoContext<Env>
export const integrations = new Hono<Env>()
integrations.onError((error,c)=>{const status=error instanceof Fault?error.status:500;return c.json({error:error instanceof Fault?error.message:'Unexpected integration error'},status as 400)})

integrations.use('*', async (c, next) => {
  const credential = await identify(c.req.raw, c.env)
  requireThat(credential, 'A scoped integration credential is required', 401)
  let status = 500
  try {
    requireThat(!credential.revoked, 'This integration credential was revoked; ask the owner for a new one', 401)
    const budget = await integrationBudget(c.env.DB, credential.id)
    const headers = () => {
      c.header('X-RateLimit-Limit', String(budget.limit))
      c.header('X-RateLimit-Remaining', String(budget.remaining))
      c.header('X-RateLimit-Reset', String(budget.reset))
    }
    headers()
    if (!budget.allowed) {
      c.header('Retry-After', String(budget.retryAfter))
      status = 429
      return c.json({ error: 'Integration request limit reached; retry after the current UTC minute' }, 429)
    }
    c.set('integration', credential)
    await next()
    // A handler may return original file bytes as a raw Response.
    headers()
    status = c.res.status
  } catch (error) {
    status = error instanceof Fault ? error.status : 500
    throw error
  } finally {
    await c.env.DB.prepare('INSERT INTO pt_integration_calls (id,credential_id,at,method,path,status) VALUES (?,?,?,?,?,?)')
      .bind(uid(), credential.id, now(), c.req.method, new URL(c.req.url).pathname, status).run()
  }
})

// Keep schema discovery behind the transport's existing credential and audit middleware.
integrations.get('/openapi.json', c => c.json(integrationOpenApi))
registerRecordReads(integrations)

function readScope(c: C, family: string) {
  return c.get('integration').scopes.includes(family + ':read') ? family + ':read' : family + ':write'
}

function context(c: C, scope: string): Context & { actor: Integration } {
  const credential = c.get('integration')
  requireThat(credential.scopes.includes(scope), `This credential needs the ${scope} scope`, 403)
  return { db: c.env.DB, env: c.env, request: c.req.raw, actor: { ...credential, scope } }
}

// Every list has a bounded page and stable ID cursor; exact lookups do not scan a capped view.
async function page(c: C, table: string, filters: Record<string, string | undefined> = {}, extra = '', params: unknown[] = []) {
  const raw = c.req.query('limit') ?? '100', limit = Number(raw)
  requireThat(/^\d+$/.test(raw) && limit >= 1 && limit <= 100, 'limit is 1–100')
  const clauses = ['id > ?'], values: unknown[] = [c.req.query('cursor') ?? '']
  for (const [query, column] of Object.entries(filters)) if (column && c.req.query(query)) { clauses.push(`${column} = ?`); values.push(c.req.query(query)) }
  if (extra) { clauses.push(extra); values.push(...params) }
  const rows = await all(c.env.DB, `SELECT * FROM ${table} WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT ?`, ...values, limit + 1)
  const more = rows.length > limit
  if (more) rows.pop()
  return { rows, nextCursor: more ? rows.at(-1)!.id : null }
}

integrations.get('/state', async c => {
  const credential = c.get('integration'), readable = credential.scopes.find(s => s !== 'post')
  requireThat(readable, 'A record scope is required', 403)
  const ctx = context(c, readable)
  await run(ctx.db, [authority(ctx.actor, 'read')])
  const contacts = credential.scopes.includes('contacts:write') ? await page(c, 'pt_contacts', { id: 'id', name: 'name' }) : null
  const bankAccounts = credential.scopes.some(s => s === 'payments:read' || s === 'payments:write')
    ? await all(ctx.db, 'SELECT b.id,b.name,b.account_id,b.institution,b.number_last4,a.code AS ledger_code,a.name AS ledger_name FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id ORDER BY b.name,b.id') : null
  return c.json({ accounts: await all(ctx.db, 'SELECT id,code,name,type,subtype,active FROM pt_accounts ORDER BY code'),
    taxCodes: await all(ctx.db, 'SELECT id,name,rate_milli_percent FROM pt_tax_codes WHERE active = 1 ORDER BY name'),
    ...(bankAccounts ? { bankAccounts } : {}),
    ...(contacts ? { contacts: contacts.rows.map(row => nativeRecord('contacts', row)), nextCursor: contacts.nextCursor } : {}) })
})

for (const spec of [
  { path: '/contacts', scope: 'contacts:write', table: 'pt_contacts', key: 'contacts', filters: { id: 'id', name: 'name', kind: 'kind', active: 'active' }, read: contact },
  { path: '/bills', scope: 'bills:write', table: 'pt_bills', key: 'bills', filters: { id: 'id', reference: 'reference', vendorId: 'vendor_id', status: 'status', date: 'bill_date' }, read: bill },
  { path: '/invoices', scope: 'invoices:write', table: 'pt_invoices', key: 'invoices', filters: { id: 'id', number: 'number', customerId: 'customer_id', status: 'status', date: 'issue_date' }, read: invoice },
  { path: '/journals', scope: 'journals:write', table: 'pt_journal_entries', key: 'entries', filters: { id: 'id', memo: 'memo', status: 'status', date: 'entry_date' }, read: entry },
]) integrations.get(spec.path, async c => {
  const ctx = context(c, readScope(c, spec.path.slice(1))), p = await page(c, spec.table, spec.filters)
  await run(ctx.db, [authority(ctx.actor, 'read')])
  return c.json({ [spec.key]: await Promise.all(p.rows.map(async r => nativeRecord(spec.path.slice(1), await spec.read(ctx.db, r.id)))), nextCursor: p.nextCursor })
})

for (const spec of [
  { path: 'contacts', read: contact }, { path: 'bills', read: bill },
  { path: 'invoices', read: invoice }, { path: 'journals', read: entry },
  { path: 'payments', read: payment },
]) integrations.get('/' + spec.path + '/:id', async c => {
  const ctx = context(c, readScope(c, spec.path))
  await run(ctx.db, [authority(ctx.actor, 'read')])
  return c.json(nativeRecord(spec.path, await spec.read(ctx.db, c.req.param('id')!)))
})

integrations.get('/documents', async c => {
  const ctx = context(c, readScope(c, 'documents')), p = await page(c, 'pt_documents', { id: 'id', name: 'name', linkedId: 'linked_id' })
  await run(ctx.db, [authority(ctx.actor, 'read')])
  return c.json({ documents: p.rows.map(row => nativeRecord('documents', row)), nextCursor: p.nextCursor })
})
integrations.get('/documents/:id', async c => {
  const ctx = context(c, readScope(c, 'documents')), doc = await documentFile(ctx.db, c.req.param('id'))
  requireThat(doc, 'Document not found', 404)
  await run(ctx.db, [authority(ctx.actor, 'read')])
  return new Response(doc.bytes, { headers: { 'content-type': doc.mediaType, 'content-disposition': `attachment; filename="${doc.name.replace(/[^\w.-]+/g, '_')}"`, 'content-security-policy': "default-src 'none'; sandbox" } })
})
integrations.get('/payments', async c => {
  const ctx = context(c, c.get('integration').scopes.includes('payments:write') ? 'payments:write' : 'payments:read'), target = c.req.query('billId') ?? c.req.query('invoiceId')
  const kind = c.req.query('billId') ? 'bill' : 'invoice'
  const p = await page(c, 'pt_payments', { id: 'id', reference: 'reference' }, target ? "EXISTS (SELECT 1 FROM pt_allocations a WHERE a.source_kind = 'payment' AND a.source_id = pt_payments.id AND a.target_kind = ? AND a.target_id = ?)" : '', target ? [kind, target] : [])
  await run(ctx.db, [authority(ctx.actor, 'read')])
  return c.json({ payments: await Promise.all(p.rows.map(async p => nativeRecord('payments', await payment(ctx.db, p.id)))), nextCursor: p.nextCursor })
})
const vendorCreditScope = (c: C) => c.get('integration').scopes.includes('vendor-credits:write') ? 'vendor-credits:write' : 'vendor-credits:read'
integrations.get('/vendor-credits', async c => {
  const ctx = context(c, vendorCreditScope(c))
  await run(ctx.db, [authority(ctx.actor, 'read')])
  const p = await page(c, 'pt_vendor_credits', { id: 'id', vendorId: 'vendor_id', reference: 'reference' })
  return c.json({ vendorCredits: await Promise.all(p.rows.map(async r => nativeRecord('vendor-credits', await vendorCredit(ctx.db, r.id)))), nextCursor: p.nextCursor })
})
integrations.get('/vendor-credits/:id', async c => {
  const ctx = context(c, vendorCreditScope(c))
  await run(ctx.db, [authority(ctx.actor, 'read')])
  return c.json(nativeRecord('vendor-credits', await vendorCredit(ctx.db, c.req.param('id'))))
})

integrations.get('/reports/:kind', async c => {
  const ctx = context(c, 'reports:read'), kind = c.req.param('kind')
  requireThat(FINANCIAL_REPORTS.includes(kind), 'Unknown financial report', 404)
  const to = date(c.req.query('to') ?? new Date().toISOString().slice(0, 10), 'to')
  const from = date(c.req.query('from') ?? to.slice(0, 8) + '01', 'from')
  await run(ctx.db, [authority(ctx.actor, 'read')])
  return c.json(await readReport(ctx.db, kind, { from, to, basis: await reportBasis(ctx.db, c.req.query('basis')), account: c.req.query('account'), payee: c.req.query('payee'), columns: c.req.query('columns'),dimension:c.req.query('dimension'),dimensionValue:c.req.query('dimensionValue') }))
})

const document = (db: D1Database, id: string) => one(db, 'SELECT id,name,media_type,size,sha256,linked_kind,linked_id,note,uploaded_by,uploaded_at FROM pt_documents WHERE id = ?', id).then(r => r!)
for (const spec of [
  { path: '/contacts', scope: 'contacts:write', prepare: prepareContact, read: contact },
  { path: '/bills', scope: 'bills:write', prepare: prepareBill, read: bill },
  { path: '/invoices', scope: 'invoices:write', prepare: prepareInvoice, read: invoice },
  { path: '/journals', scope: 'journals:write', prepare: prepareJournal, read: entry },
  { path: '/documents', scope: 'documents:write', prepare: prepareDocument, read: document },
  { path: '/payments', scope: 'payments:write', prepare: preparePayment, read: payment },
  { path: '/vendor-credits', scope: 'vendor-credits:write', prepare: prepareVendorCredit, read: vendorCredit },
  { path: '/vendor-credits/:id/allocations', scope: 'vendor-credits:write', prepare: (ctx: Context, b: Data, c: C) => prepareVendorCreditAllocation(ctx, { ...b, creditId: c.req.param('id')! }), read: vendorCredit },
  { path: '/bills/:id/readiness', scope: 'bills:write', prepare: (ctx: Context, b: Data, c: C) => prepareReadiness(ctx, b, c.req.param('id')!), read: bill },
]) integrations.post(spec.path, async c => {
  const ctx = context(c, spec.scope)
  const raw = await c.req.text()
  requireThat(raw.length <= 8_000_000, 'Request too large', 413)
  let body: Data
  try { body = JSON.parse(raw) } catch { throw new Fault(400, 'Send a JSON object') }
  requireThat(body && typeof body === 'object' && !Array.isArray(body), 'Send a JSON object')
  requireThat(body.post === undefined || typeof body.post === 'boolean', 'post is true or false')
  const postsPayment = spec.scope === 'payments:write'
  const postsCredit = spec.scope === 'vendor-credits:write'
  if (postsCredit) requireThat(body.post !== false, 'Vendor credits and their allocations record posted adjustments and cannot be saved as drafts')
  if (postsPayment) requireThat(body.post !== false, 'Payments record money already moved and cannot be saved as drafts')
  if (postsPayment || postsCredit || body.post === true) requireThat(c.get('integration').scopes.includes('post'), postsPayment ? 'Recording an external payment needs the post grant' : postsCredit ? 'Recording or applying a vendor credit needs the post grant' : 'This credential needs the post grant; omit post or send false to save a draft', 403)
  const operation = c.req.path
  return c.json(await idempotent(ctx, operation, body, async () => {
    const p: Prepared = await spec.prepare(ctx, body, c)
    if (postsPayment || postsCredit || body.post === true) p.statements.unshift(authority(ctx.actor, 'post'))
    return p
  }, async id => nativeRecord(spec.path.split('/')[1], await spec.read(ctx.db, id))))
})
