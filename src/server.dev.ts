// Local-only Worker entry. vite.config.ts loads it only for `vite dev`; the
// deployed main stays src/server.ts, and `rer build` refuses any output that
// contains the dev layer. It adds dev sign-in, personas and the Dev title and name suffix.
import worker from './server'
import { withDevIdentity } from './modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings, signedInForward, type Bindings } from './auth.server'
import { devPersonas } from './dev-personas'
import { withDevAi } from './modules/ai/dev/index.mjs'
import { fontLinks } from './base/font-head'

const development = withDevAi<Bindings, typeof worker>(worker, { bindings: runtimeBindings })
const local = withDevIdentity<Bindings, typeof worker>(development, { bindings: runtimeBindings, config: authConfig, personas: devPersonas })

// The dev layer draws its one-click sign-in, its hand-off and its sign-in refusal itself, linking only the theme.
// Pantry's look is in /fonts/fonts.css (the theme holds only its tokens and faces), so these pages link it once,
// right before the theme, where the theme's @import used to load it: they draw as they did.
const look = fontLinks.find(link => link.rel === 'stylesheet')!.href
const theme = '<link rel="stylesheet" href="/rer-theme.css">'
async function withLook(response: Response): Promise<Response> {
  if (!response.headers.get('content-type')?.startsWith('text/html')) return response
  const html = await response.clone().text()
  if (html.includes(look) || !html.includes(theme)) return response
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(html.replace(theme, `<link rel="stylesheet" href="${look}">${theme}`), { status: response.status, statusText: response.statusText, headers })
}

export default { ...local, async fetch(request: Parameters<typeof local.fetch>[0], env: Bindings, context: ExecutionContext) {
  const response = await local.fetch(request, env, context)
  const forward = await signedInForward(request, env)
  if (forward) return forward
  return ['/signin', '/__dev/key', '/auth/dev/enter'].includes(new URL(request.url).pathname) ? withLook(response) : response
} }
