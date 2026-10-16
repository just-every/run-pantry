// Plaid Link in the browser: Plaid's own script, opened with a link token the
// server made. Resolves with the public token, or null when the person closes it.
// Banks that sign in through their own site return here with oauth_state_id;
// the same link token then resumes Link.
declare global { interface Window { Plaid?: { create: (o: Record<string, unknown>) => { open: () => void; destroy: () => void } } } }

const SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
const KEY = 'pantry.plaid-link'
let loading: Promise<void> | null = null

function load() {
  if (window.Plaid) return Promise.resolve()
  return loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT; s.async = true
    s.onload = () => resolve(); s.onerror = () => { loading = null; reject(new Error('Plaid Link did not load; check your connection and try again')) }
    document.head.appendChild(s)
  })
}

export type LinkResult = { publicToken: string; institution: { institution_id?: string; name?: string } | null }

export async function openLink(token: string, purpose: string, resume = false): Promise<LinkResult | null> {
  await load()
  try { sessionStorage.setItem(KEY, JSON.stringify({ token, purpose })) } catch { /* resuming after a bank's own sign-in needs storage; Link still opens */ }
  return new Promise(resolve => {
    const handler = window.Plaid!.create({
      token, ...(resume ? { receivedRedirectUri: window.location.href } : {}),
      onSuccess: (publicToken: string, metadata: { institution?: LinkResult['institution'] }) => { handler.destroy(); resolve({ publicToken, institution: metadata?.institution ?? null }) },
      onExit: () => { handler.destroy(); resolve(null) },
    })
    handler.open()
  })
}

/** The link token and purpose saved before a bank's own sign-in sent the person away, if this page is their return. */
export function pendingLink(): { token: string; purpose: string } | null {
  if (typeof window === 'undefined' || !new URLSearchParams(window.location.search).get('oauth_state_id')) return null
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') } catch { return null }
}
