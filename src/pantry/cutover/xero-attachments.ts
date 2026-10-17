// Attachments carried over from Xero after a Xero move-in: the person connects
// Xero (read-only invoices and attachments), Pantry finds each imported open
// invoice and bill in Xero by its number, lists its attachments and keeps each
// file byte for byte as a document on the imported record. It runs in small
// batches (Worker subrequests, Xero's 60 calls a minute) until nothing is left.
import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { authority, must, person, who } from '../access'
import { documentInsert } from '../contacts'
import { now, requireThat, text, uid, Fault } from '../core'
import { all, audit, one, q, run } from '../db'
import { open, seal } from '../feeds/vault'
import type { Command, Context } from '../context'
import { accounting, authorizeUrl, connections, disconnect, exchangeCode, refreshTokens, xeroAvailability, XeroWait, type Tokens, type XeroAttachment, type XeroInvoice } from './xero-api'

const MAX_BYTES = 1_500_000 // Pantry's document limit
const CALLS = 40 // Xero calls per batch: well inside a Worker's subrequest limit
const STATE_MINUTES = 15

function available(env: Bindings) {
  const a = xeroAvailability(env)
  requireThat(a.available, a.available ? '' : a.reason, 503)
}

async function link(db: D1Database) {
  return one(db, 'SELECT * FROM pt_xero_connection WHERE id = 1')
}

async function tokens(c: Context): Promise<{ tokens: Tokens; tenantId: string; calls: number }> {
  const l = await link(c.db)
  requireThat(l?.status === 'connected', 'Connect Xero first', 409)
  const plain = await open(c.env.SESSION_SECRET, l.tokens)
  requireThat(plain, 'Pantry cannot read the saved Xero sign-in (the installation’s session secret changed); connect Xero again', 409)
  let t = JSON.parse(plain) as Tokens, calls = 0
  if (t.expiresAt < Date.now() + 60_000) {
    t = await refreshTokens(c.env, t.refresh); calls++
    // Xero rotates the refresh token on every use: keep the new one before anything else can fail.
    await run(c.db, [q('UPDATE pt_xero_connection SET tokens = ? WHERE id = 1', await seal(c.env.SESSION_SECRET, JSON.stringify({ access: t.access, refresh: t.refresh, expiresAt: t.expiresAt })))])
  }
  return { tokens: t, tenantId: l.tenant_id, calls }
}

/** The open invoices and bills a Xero move-in brought in. */
const imported = (db: D1Database) => all(db, `SELECT i.id, 'invoice' AS kind, i.number AS number, c.name AS party FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.id LIKE 'xero-%'
  UNION ALL SELECT b.id, 'bill', b.reference, c.name FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id WHERE b.id LIKE 'xero-%' ORDER BY 2, 3`)

export async function xeroView(c: Context) {
  const a = xeroAvailability(c.env), l = await link(c.db)
  const items = await imported(c.db)
  const looked = await all(c.db, 'SELECT * FROM pt_xero_items')
  const files = await all(c.db, 'SELECT a.id, a.item_id, a.item_kind, a.file_name, a.media_type, a.size, a.status, a.document_id, i.number FROM pt_xero_attachments a JOIN pt_xero_items i ON i.item_id = a.item_id ORDER BY i.number, a.file_name')
  const pending = items.length - looked.length + looked.filter(x => x.status === 'found' && x.has_attachments && !x.listed).length + files.filter(f => f.status === 'pending').length
  return {
    available: a.available, reason: a.available ? '' : a.reason,
    connection: l?.status === 'connected' ? { tenantName: l.tenant_name, connectedBy: l.connected_by, connectedAt: l.connected_at } : null,
    items: items.length, checked: looked.length,
    notFound: looked.filter(x => x.status === 'not-found').map(x => ({ kind: x.item_kind, number: x.number })),
    files, carried: files.filter(f => f.status === 'carried').length, tooLarge: files.filter(f => f.status === 'too-large').length,
    done: pending === 0,
  }
}

const connect: Command = { need: 'record', async run(c) {
  available(c.env)
  requireThat(await one(c.db, "SELECT 1 FROM ik_jobs WHERE destination = 'books' AND namespace = 'xero-cutover' AND state = 'completed'"), 'Import your Xero exports first; attachments are carried onto the records that import brings in', 409)
  const state = uid()
  await run(c.db, [authority(c.actor, 'record'),
    q("INSERT INTO pt_xero_connection (id, status, state, state_by, state_at) VALUES (1, 'pending', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, state_by = excluded.state_by, state_at = excluded.state_at, status = CASE WHEN status = 'connected' THEN status ELSE 'pending' END", state, c.actor.email, now())])
  return { url: authorizeUrl(c.env, state) }
} }

/** One batch: find imported items in Xero, list their attachments, keep their files. */
const carry: Command = { need: 'record', async run(c) {
  available(c.env)
  const s = await tokens(c)
  let budget = CALLS - s.calls
  const call = async (path: string, accept?: string) => { budget--; return accounting(s.tokens.access, s.tenantId, path, accept) }
  try {
    // 1. Find each imported invoice and bill in Xero by its number (and supplier, for bills).
    const seen = new Set((await all(c.db, 'SELECT item_id FROM pt_xero_items')).map(x => x.item_id))
    const todo = (await imported(c.db)).filter(x => !seen.has(x.id))
    for (let i = 0; i < todo.length && budget > 0; i += 25) {
      const chunk = todo.slice(i, i + 25), found: XeroInvoice[] = []
      for (let page = 1; budget > 0; page++) {
        const r = await call(`/Invoices?${new URLSearchParams({ InvoiceNumbers: [...new Set(chunk.map(x => x.number))].join(','), page: String(page) })}`)
        const list = ((await r?.json()) as any)?.Invoices as XeroInvoice[] ?? []
        found.push(...list)
        if (list.length < 100) break
      }
      await run(c.db, [authority(c.actor, 'record'), ...chunk.map(x => {
        const m = found.find(v => v.InvoiceNumber === x.number && v.Type === (x.kind === 'invoice' ? 'ACCREC' : 'ACCPAY') && (x.kind === 'invoice' || v.Contact?.Name?.toLowerCase() === String(x.party).toLowerCase()))
        return q('INSERT INTO pt_xero_items (item_id, item_kind, number, xero_id, status, has_attachments, listed, checked_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(item_id) DO NOTHING',
          x.id, x.kind, x.number, m?.InvoiceID ?? null, m ? 'found' : 'not-found', m?.HasAttachments ? 1 : 0, now())
      })])
    }
    // 2. List the attachments of each item Xero says has some.
    for (const item of await all(c.db, "SELECT * FROM pt_xero_items WHERE status = 'found' AND has_attachments = 1 AND listed = 0")) {
      if (budget <= 0) break
      const r = await call(`/Invoices/${item.xero_id}/Attachments`)
      const files = (((await r?.json()) as any)?.Attachments ?? []) as XeroAttachment[]
      await run(c.db, [authority(c.actor, 'record'), ...files.map(f => q('INSERT INTO pt_xero_attachments (id, item_id, item_kind, xero_item_id, file_name, media_type, size, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
        f.AttachmentID, item.item_id, item.item_kind, item.xero_id, f.FileName, f.MimeType || 'application/octet-stream', Number(f.ContentLength ?? 0), Number(f.ContentLength ?? 0) > MAX_BYTES ? 'too-large' : 'pending')),
        q('UPDATE pt_xero_items SET listed = 1 WHERE item_id = ?', item.item_id)])
    }
    // 3. Keep each file, exactly as Xero returns it, as a document on the imported record.
    for (const f of await all(c.db, "SELECT * FROM pt_xero_attachments WHERE status = 'pending' ORDER BY item_id, file_name")) {
      if (budget <= 0) break
      const r = await call(`/Invoices/${f.xero_item_id}/Attachments/${f.id}`, f.media_type)
      requireThat(r, `Xero no longer has ${f.file_name}; connect Xero again or upload it in Documents`, 409)
      const bytes = new Uint8Array(await r.arrayBuffer())
      if (bytes.length > MAX_BYTES || bytes.length === 0) { await run(c.db, [q("UPDATE pt_xero_attachments SET status = 'too-large', size = ? WHERE id = ?", bytes.length, f.id)]); continue }
      const doc = await documentInsert(c, { name: text(f.file_name, 'File name', 200), mediaType: f.media_type, bytes, linkedKind: f.item_kind, linkedId: f.item_id, note: 'Carried over from Xero' })
      await run(c.db, [authority(c.actor, 'record'), doc.statement,
        q("UPDATE pt_xero_attachments SET status = 'carried', size = ?, document_id = ? WHERE id = ? AND status = 'pending'", bytes.length, doc.id, f.id),
        audit(who(c.actor), 'move-in.xero-attachment', 'document', doc.id, { file: f.file_name, sha256: doc.sha256, linkedKind: f.item_kind, linkedId: f.item_id })])
    }
  } catch (e) {
    if (e instanceof XeroWait) return { ...(await xeroView(c)), wait: e.seconds }
    throw e
  }
  return xeroView(c)
} }

const unlink: Command = { need: 'record', async run(c) {
  const l = await link(c.db)
  requireThat(l, 'Xero is not connected', 409)
  if (l.status === 'connected' && xeroAvailability(c.env).available) {
    const plain = await open(c.env.SESSION_SECRET, l.tokens)
    if (plain) await disconnect(c.env, JSON.parse(plain), l.connection_id)
  }
  await run(c.db, [authority(c.actor, 'record'), q('DELETE FROM pt_xero_connection WHERE id = 1'), audit(who(c.actor), 'move-in.xero-disconnect', 'xero', l.tenant_id ?? 'pending', { tenant: l.tenant_name })])
  return xeroView(c)
} }

export const xeroCommands: Record<string, Command> = {
  'move-in.xero.connect': connect,
  'move-in.xero.carry': carry,
  'move-in.xero.disconnect': unlink,
}

/** What an undone import leaves behind: the documents it carried and the record of carrying them. */
export const forgetCarried = () => [
  q("DELETE FROM pt_documents WHERE id IN (SELECT document_id FROM pt_xero_attachments WHERE document_id IS NOT NULL)"),
  q('DELETE FROM pt_xero_attachments'), q('DELETE FROM pt_xero_items'),
]

/** Xero sends the person back here after they choose an organization. */
export function xeroRoutes(api: Hono<{ Bindings: Bindings }>) {
  api.get('/api/pantry/xero/callback', async c => {
    const back = (query: string) => c.redirect(`/app/move-in?${query}`, 303)
    const actor = await person(c.req.raw, c.env)
    must(actor, 'record')
    try {
      available(c.env)
      const l = await link(c.env.DB), state = c.req.query('state') ?? ''
      requireThat(l?.state && l.state === state && l.state_by === actor.email && Date.parse(l.state_at) > Date.now() - STATE_MINUTES * 60_000, 'This Xero sign-in was not started here or has expired; connect Xero again', 409)
      requireThat(!c.req.query('error'), `Xero did not connect: ${c.req.query('error_description') ?? c.req.query('error')}`, 409)
      const t = await exchangeCode(c.env, text(c.req.query('code'), 'Xero code', 2000))
      const chosen = (await connections(t.access)).filter(x => x.tenantType === 'ORGANISATION' && (!t.authEventId || x.authEventId === t.authEventId))
      requireThat(chosen.length === 1, chosen.length ? 'Choose one Xero organization when Xero asks, then connect again' : 'Xero connected no organization; choose the one you moved from', 409)
      const org = chosen[0], ctx: Context = { db: c.env.DB, env: c.env, request: c.req.raw, actor }
      await run(c.env.DB, [authority(actor, 'record'),
        q("UPDATE pt_xero_connection SET status = 'connected', state = NULL, tenant_id = ?, tenant_name = ?, connection_id = ?, tokens = ?, connected_by = ?, connected_at = ? WHERE id = 1 AND state = ?",
          org.tenantId, org.tenantName, org.id, await seal(c.env.SESSION_SECRET, JSON.stringify({ access: t.access, refresh: t.refresh, expiresAt: t.expiresAt })), actor.email, now(), state),
        audit(who(ctx.actor), 'move-in.xero-connect', 'xero', org.tenantId, { tenant: org.tenantName })])
      return back('xero=connected')
    } catch (e) {
      if (e instanceof Fault) return back(`xero_error=${encodeURIComponent(e.message)}`)
      throw e
    }
  })
}
