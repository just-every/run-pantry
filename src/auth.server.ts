import { createDependencies } from './modules/dependencies/index.mjs'
import { createIdpOwnerClaimHandler, createOwnerClaimHandler } from './modules/owner-claim/index.mjs'
import { firstRunResponse } from './base/setup'
import { fontDocumentResponse } from './base/font-response'
import { createOperatorAuth, createAuthHandler, createSignInHandler, safeReturnTo, devGate, devNotFound, type AuthConfig } from './modules/operator-auth/index.mjs'
import { operatorMail } from './mail.server.mjs'
import branding from './branding.json'
import { signOutResponse, withSignOut } from './signout.server'

// The edition's declared theme (public/rer-theme.css), as Base frames link it.
const theme = { href: '/rer-theme.css', productName: branding.name, accentColor: branding.primaryColor }

export interface Bindings {
 DB: D1Database
 /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
 ASSETS?: Fetcher
 RER_DEPLOY_SOURCE?: string
 RER_DEPLOY_FINGERPRINT?: string
 RER_VERSION?: { id: string }
 /** Exact client origins the owner permits this console to contact. */
 PANTRY_ACCOUNTANT_CLIENTS?: string
 IDENTITY_PROVIDER?: string
 AUTH_ORIGIN: string
 AUTH_LOCAL?: string
 RER_DEV_ORIGIN?: string
 /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
 RER_MODELS_SERVICE?: string
 RER_MODELS_KEY?: string
 RER_DEV_KEY?: string
 RER_DEV_IDENTITY?: string
 RER_INSTALLATION_ID?: string
 RER_MANAGEMENT_ORIGIN?: string
 RER_OWNER_CLAIM_PUBLIC_KEYS?: string
 RER_OWNER_CLAIM_ISSUER?: string
 RER_OWNER_CLAIM_INSTALLATION_ID?: string
 RER_DEMO?: string
 RER_BUSINESS?: string
 OWNER_EMAIL: string
 SESSION_SECRET: string
 INSTALLATION_KEY?: string
 INSTALLATION_KEY_PREVIOUS?: string
 SETUP_TOKEN?: string
 MAIL_PROVIDER?: 'development' | 'rer' | 'resend' | 'sendgrid' | 'cloudflare'
 MAIL_RELAY_URL?: string
 MAIL_FROM?: string
 MAIL_API_KEY?: string
 MAIL_ACCOUNT_ID?: string
 /** Live bank and card feeds: this installation's own Plaid keys (self-hosted installs). */
 PLAID_CLIENT_ID?: string
 PLAID_SECRET?: string
 PLAID_ENV?: string
 PLAID_REDIRECT_URI?: string
 /** Attachments carried over from Xero at move-in: this installation's own Xero app (self-hosted installs). */
 XERO_CLIENT_ID?: string
 XERO_CLIENT_SECRET?: string
 /** This installation's own Intuit app, used only for an owner-authorized move-in. */
 QBO_CLIENT_ID?: string
 QBO_CLIENT_SECRET?: string
 /** Payroll from Gusto: this installation's own Gusto app (self-hosted installs). */
 GUSTO_CLIENT_ID?: string
 GUSTO_CLIENT_SECRET?: string
 GUSTO_ENV?: string
}

export const runtimeBindings = (env: Bindings): Bindings => env.RER_DEV_ORIGIN && env.AUTH_LOCAL === 'true' ? { ...env, AUTH_ORIGIN: env.RER_DEV_ORIGIN } : env
// MAIL_FROM is the bare address rer deploy accepts; sign-in and invitation emails carry the app's name.
const senderFrom = (from?: string) => from && !from.includes('<') ? `${branding.name.replace(/[<>"\\,;:@()[\]]/g, '').trim()} <${from.trim()}>` : from
export const authConfig = (env: Bindings): AuthConfig => ({ dependencies: true, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true', OWNER_EMAIL: env.OWNER_EMAIL, SESSION_SECRET: env.SESSION_SECRET, INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, SETUP_TOKEN: env.SETUP_TOKEN, MAIL_FROM: senderFrom(env.MAIL_FROM), branding: { productName: branding.name, accentColor: branding.primaryColor, signInPath: '/signin', theme: theme.href } })
export function operatorAuth(env: Bindings) {
 return createOperatorAuth({ db: env.DB, config: authConfig(env), mailSender: operatorMail(env), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' })
}

const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow' }
/** Forward live sessions while retaining the explicit local person chooser. */
export async function signedInForward(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 if (url.pathname !== '/signin' || request.method !== 'GET' || (env.AUTH_LOCAL === 'true' && url.searchParams.get('switch') === '1')) return null
 if (!await operatorAuth(env).getSession(request)) return null
 return new Response(null, { status: 303, headers: { ...privateHeaders, location: safeReturnTo(url.searchParams.get('returnTo')) } })
}

export async function authResponse(request: Request, original: Bindings): Promise<Response | null> {
 const env = runtimeBindings(original), url = new URL(request.url)
 if (url.pathname.startsWith('/.well-known/rer-') || url.pathname.startsWith('/auth/dependencies/')) {
  const linked = await createDependencies({ db: env.DB, INSTALLATION_KEY: env.INSTALLATION_KEY, INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS, origin: env.AUTH_ORIGIN, name: branding.name, provider: env.IDENTITY_PROVIDER, local: env.AUTH_LOCAL === 'true', auth: operatorAuth(env), claimOwner: token => createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:()=>request.headers.get('CF-Connecting-IP')??''})(new Request(env.AUTH_ORIGIN+'/auth/owner-claim',{method:'POST',headers:{Host:new URL(env.AUTH_ORIGIN).host,Origin:env.AUTH_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({token})})) }).handle(request)
  if (linked) return linked
 }
 if (url.pathname === '/auth/owner-claim' && env.RER_OWNER_CLAIM_PUBLIC_KEYS) return createOwnerClaimHandler({ db: env.DB, authConfig: authConfig(env), clientIp: req => req.headers.get('CF-Connecting-IP') ?? '', issuer: env.RER_OWNER_CLAIM_ISSUER ?? '', installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '', appOrigin: env.AUTH_ORIGIN, expectedEmail: env.OWNER_EMAIL, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) })(request)
 if (url.pathname === '/auth/owner-claim') return createIdpOwnerClaimHandler({db:env.DB,authConfig:authConfig(env),clientIp:req=>req.headers.get('CF-Connecting-IP')??''})(request)
 // The key exchange answers only a local runtime holding RER_DEV_KEY.
 if (url.pathname === '/__dev/key') {
  const gate = devGate({ key: env.RER_DEV_KEY, origin: env.AUTH_ORIGIN, local: env.AUTH_LOCAL === 'true' })
  return gate ? await gate.exchange(request) ?? devNotFound() : devNotFound()
 }
 // The shared server-rendered sign-in page: plain forms that work before any script.
 if (url.pathname === '/signin') {
  const forward = await signedInForward(request, env)
  if (forward) return forward
  const page = await createSignInHandler(operatorAuth(env), { defaultReturnTo: '/setup' })(request)
  if (page) return fontDocumentResponse(await withSignOut(page, request, env))
 }
 if (url.pathname === '/signout') return fontDocumentResponse(await signOutResponse(request, env))
 if (url.pathname.startsWith('/auth/')) return fontDocumentResponse(await createAuthHandler(operatorAuth(env))(request))
 if (url.pathname === '/setup' || url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const setup = await firstRunResponse(request, env, operatorAuth(env), { theme })
  if (setup) return setup
 }
 // The app document carries no books data; it loads them through the API with
 // the same session. Signed-out visitors sign in and return to the page they asked for.
 if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
  const session = await operatorAuth(env).getSession(request)
  if (!session) return new Response(null, { status: 303, headers: { ...privateHeaders, location: `/signin?returnTo=${encodeURIComponent(url.pathname)}` } })
 }
 return null
}
