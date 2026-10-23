import { withDemo } from './modules/demo/index.mjs'
import { seedDemo } from './demo'
import start from '@tanstack/react-start/server-entry'
import { dispatch } from './base/dispatch'
import { staticAssetResponse } from './base/static-assets'
import { lobbyResponse } from './base/lobby'
import { setupStateResponse } from './base/setup-state'
import { authResponse, runtimeBindings, type Bindings } from './auth.server'
import { identity } from './identity'
import { api } from './pantry/api'
import { emailHandler } from './pantry/receipts/mail'
import { runScheduled } from './pantry/scheduled'

// Start documents keep their own cache policy and add no-transform, so no proxy
// rewrites the HTML React hydrates (Cloudflare's email address obfuscation
// honours it; src/base/hydration/README.md).
function noTransform(response: Response): Response {
  const headers = new Headers(response.headers), policy = headers.get('cache-control')
  headers.set('cache-control', policy ? `${policy}, no-transform` : 'no-transform')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default withDemo({
  async fetch(request, env, execution) {
    const asset = await staticAssetResponse(request, env)
    if (asset) return asset
    const auth = await authResponse(request, env)
    if (auth) return auth
    // The installed variant: the Lobby at / and the public claim state it reads.
    // Local dev serves the saved origin's data at its own port (RER_DEV_ORIGIN).
    const state = await setupStateResponse(request, runtimeBindings(env))
    if (state) return state
    const lobby = await lobbyResponse(request, runtimeBindings(env), identity)
    if (lobby) return lobby
    // Retained invoice and estimate customer links use the API's public routes.
    if (/^\/(i|e|qbo)\//.test(new URL(request.url).pathname)) return api.fetch(request, env, execution)
    return dispatch(request, () => api.fetch(request, env, execution), async () => noTransform(await start.fetch(request)))
  },
  // Cron: bank and card feed pulls (each connection is due every few hours, sooner after a webhook),
  // then invoices' due work: reminders, recurring invoices and Stripe follow-up, and about hourly
  // the books agent's look for what doesn't add up.
  async scheduled(controller, env) {
    await runScheduled(controller,runtimeBindings(env))
  },
  // Cloudflare Email Routing delivers mail for the Pantry address here: forwarded receipts, and replies to Pantry's questions.
  async email(message, env) {
    await emailHandler(message, runtimeBindings(env))
  },
} satisfies ExportedHandler<Bindings>, { seed: seedDemo })
