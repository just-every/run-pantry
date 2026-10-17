// Signing out, and switching person, from inside the app: /signout asks once and signs out with a
// same-origin form, then opens the sign-in page; the sign-in page itself offers it to whoever is signed in.
// @ts-expect-error Base's auth page frame ships without type declarations.
import { pageResponse } from './modules/operator-auth/page.mjs'
import { authConfig, operatorAuth, type Bindings } from './auth.server'

const escape = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const seeOther = (location: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { 'cache-control': 'no-store', location, ...headers } })

export async function signOutResponse(request: Request, env: Bindings): Promise<Response> {
  const auth = operatorAuth(env), session = await auth.getSession(request)
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== env.AUTH_ORIGIN) return new Response('Invalid origin', { status: 403 })
    if (!session) return seeOther('/signin')
    const { cookie } = await auth.signOut(request)
    return seeOther('/signin', { 'set-cookie': cookie })
  }
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, POST' } })
  if (!session) return seeOther('/signin')
  const local = env.AUTH_LOCAL === 'true'
  const content = `<p>Signed in as ${escape(session.operator.displayName || session.operator.email)} (${escape(session.operator.email)}).</p>`
    + `<form method="post" action="/signout"><button type="submit">Sign out</button></form>`
    + `<p class="secondary-link">${local ? '<a href="/signin">Switch person</a> · ' : ''}<a href="/app">Back to Pantry</a></p>`
  return pageResponse({ branding: authConfig(env).branding, heading: 'Sign out of Pantry', content, method: request.method, referrer: 'strict-origin' })
}

/** The sign-in page, with who is signed in and a way to sign out when someone is. */
export async function withSignOut(page: Response, request: Request, env: Bindings): Promise<Response> {
  const session = await operatorAuth(env).getSession(request)
  if (!session || !page.headers.get('content-type')?.startsWith('text/html') || request.method === 'HEAD') return page
  const html = (await page.text()).replace('</main>', `<p class="secondary-link">Signed in as ${escape(session.operator.email)} · <a href="/signout">Sign out</a></p></main>`)
  const headers = new Headers(page.headers)
  headers.delete('content-length')
  return new Response(html, { status: page.status, headers })
}
