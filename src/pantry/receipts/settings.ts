// AI reading settings: the owner enters the install's own model key on the
// page; it is sealed at rest and never sent back to a browser. Managed hosting
// has no outbound connection for seed integrations yet, so it says so plainly.
import type { Bindings } from '../../auth.server'
import { authority, who } from '../access'
import { now, optionalText, requireThat, text, uid, type Data } from '../core'
import { audit, one, q, run } from '../db'
import type { Command, Context } from '../context'
import { seal, unseal } from '../seal'
import { DEFAULTS, readReceipt, ReaderError, type Provider, type ReaderConfig } from './reader'

const PURPOSE = 'ai-reader-key'

export const MANAGED_LINE = 'Not available yet on RER Managed hosting: it has no outbound connection for AI providers. Reading works on a self-hosted install.'
export const managed = (env: Bindings) => String(env.MAIL_PROVIDER) === 'rer'

export type ReaderState = { config: ReaderConfig } | { unavailable: string } | { missing: string }

/** The working reader, or the one plain line saying why there is none. */
export async function readerState(db: D1Database, env: Bindings): Promise<ReaderState> {
  if (managed(env)) return { unavailable: MANAGED_LINE }
  const row = await one(db, 'SELECT * FROM pt_reader WHERE id = 1')
  if (!row) return { missing: 'Add a key to read receipts.' }
  const key = await unseal(env.SESSION_SECRET, PURPOSE, row.key_sealed)
  if (!key) return { missing: 'The saved AI key cannot be opened on this install; add it again to read receipts.' }
  return { config: { provider: row.provider as Provider, endpoint: row.endpoint, model: row.model, key, workspace: row.workspace } }
}

export async function readerView(c: Context): Promise<Data> {
  const row = await one(c.db, 'SELECT provider, endpoint, model, workspace, key_hint, updated_by, updated_at, revision FROM pt_reader WHERE id = 1')
  const state = await readerState(c.db, c.env)
  return { saved: row, unavailable: 'unavailable' in state ? state.unavailable : null, missing: 'missing' in state ? state.missing : null, defaults: DEFAULTS }
}

const saveReader: Command = { need: 'owner', async run(c, b) {
  requireThat(!managed(c.env), MANAGED_LINE, 409)
  const provider = text(b.provider, 'Provider') as Provider
  requireThat(provider === 'anthropic' || provider === 'openai', 'Choose Anthropic or an OpenAI-compatible provider')
  const endpoint = optionalText(b.endpoint, 'Endpoint', 300) || DEFAULTS[provider].endpoint
  requireThat(/^https:\/\/[^\s/]+\/\S*$/.test(endpoint), 'The endpoint is an https:// address')
  const model = optionalText(b.model, 'Model', 120) || DEFAULTS[provider].model
  requireThat(model, 'Enter the model name your provider gave you')
  const workspace = provider === 'anthropic' ? optionalText(b.workspace, 'Workspace ID', 120) : ''
  const current = await one(c.db, 'SELECT revision FROM pt_reader WHERE id = 1')
  // Changing the model or endpoint keeps the saved key unless a new one is entered.
  const entered = optionalText(b.key, 'API key', 400)
  requireThat(entered || current, 'Paste the API key')
  const sealed = entered ? await seal(c.env.SESSION_SECRET, PURPOSE, entered) : null
  const hint = entered ? `…${entered.slice(-4)}` : null
  await run(c.db, [authority(c.actor, 'owner'),
    current
      ? q('UPDATE pt_reader SET provider = ?, endpoint = ?, model = ?, workspace = ?, key_sealed = COALESCE(?, key_sealed), key_hint = COALESCE(?, key_hint), updated_by = ?, updated_at = ?, revision = ? WHERE id = 1', provider, endpoint, model, workspace, sealed, hint, c.actor.email, now(), uid())
      : q('INSERT INTO pt_reader (id, provider, endpoint, model, workspace, key_sealed, key_hint, updated_by, updated_at, revision) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)', provider, endpoint, model, workspace, sealed, hint, c.actor.email, now(), uid()),
    audit(who(c.actor), 'reader.save', 'settings', 'ai-reading', { provider, endpoint, model, keyChanged: !!entered })])
  return readerView(c)
} }

const removeReader: Command = { need: 'owner', async run(c) {
  await run(c.db, [authority(c.actor, 'owner'), q('DELETE FROM pt_reader WHERE id = 1'), audit(who(c.actor), 'reader.remove', 'settings', 'ai-reading')])
  return readerView(c)
} }

// A made-up receipt: the check sends no data from these books.
const SAMPLE = 'From: orders@example-hardware.test\nSubject: Your receipt\n\nExample Hardware Co.\nOrder date: March 3, 2026\nPaint roller x2  $18.00\nSubtotal $18.00\nSales tax $1.49\nTotal charged $19.49 (Visa ending 1234)'

const testReader: Command = { need: 'owner', async run(c) {
  const state = await readerState(c.db, c.env)
  if (!('config' in state)) return { ok: false, message: 'unavailable' in state ? state.unavailable : state.missing }
  try {
    const r = await readReceipt(state.config, { kind: 'text', text: SAMPLE, name: 'sample receipt' }, [{ code: '6300', name: 'Office supplies' }])
    const ok = r.total === 1949 && r.date === '2026-03-03'
    return { ok, message: `${ok ? 'Working' : 'The model answered, but misread the sample'}: ${r.vendor ?? 'no vendor'}, ${r.date ?? 'no date'}, total ${r.total === null ? 'unread' : '$' + (r.total / 100).toFixed(2)}, tax ${r.tax === null ? 'unread' : '$' + (r.tax / 100).toFixed(2)}.` }
  } catch (e) {
    return { ok: false, message: e instanceof ReaderError ? e.message : 'The AI model could not be reached.' }
  }
} }

export const readerCommands: Record<string, Command> = {
  'reader.save': saveReader,
  'reader.remove': removeReader,
  'reader.test': testReader,
}
