import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import type { Context } from '../context'
import { must } from '../access'
import { requireThat } from '../core'
import { autopayView } from './policy'
import { confirmAutopaySetup, publicAutopay, revokeAutopay, startAutopaySetup } from './setup'

async function body(request: Request) {
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let length = 0
  if (reader) for (;;) {
    const part = await reader.read()
    if (part.done) break
    length += part.value.length
    if (length > 4096) { await reader.cancel(); requireThat(false, 'Request too large', 413) }
    chunks.push(part.value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let parsed
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { requireThat(false, 'Send a JSON object') }
  requireThat(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Send a JSON object')
  return parsed
}

export function registerAutopayRoutes(api: Hono<{ Bindings: Bindings }>, reader: (c: any) => Promise<Context>) {
  api.get('/api/pantry/autopay/:customerId', async c => {
    const ctx = await reader(c)
    must(ctx.actor, 'owner')
    return c.json(await autopayView(ctx.env, ctx.db, c.req.param('customerId')))
  })
  api.get('/i/:token/autopay', async c => c.json(await publicAutopay(c.env, c.env.DB, c.req.param('token'))))
  api.post('/i/:token/autopay/setup', async c => c.json(await startAutopaySetup(c.env, c.env.DB, c.req.param('token'), await body(c.req.raw), c.req.raw)))
  for (const op of ['confirm', 'revoke'] as const) api.post(`/i/:token/autopay/${op}`, async c => {
    requireThat(c.req.header('origin') === runtimeBindings(c.env).AUTH_ORIGIN && c.req.header('sec-fetch-site') !== 'cross-site', 'Invalid origin', 403)
    const token = c.req.param('token')
    return c.json(op === 'revoke' ? await revokeAutopay(c.env.DB, token) : await confirmAutopaySetup(c.env, c.env.DB, token, (await body(c.req.raw)).sessionId))
  })
}
