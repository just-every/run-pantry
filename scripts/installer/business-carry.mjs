import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Local identity is a display prefill, never an authorization credential. */
export function readBusinessCarry(root = process.cwd(), log = console.warn) {
  try {
    const value = JSON.parse(readFileSync(resolve(root, '.rer/local/business.json'), 'utf8'))
    if (!value || value.version !== 1) throw new Error('version')
    const origin = new URL(value.origin)
    if (origin.origin !== value.origin || !(origin.protocol === 'https:' ||
      (origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))) throw new Error('origin')
    if (typeof value.business_url !== 'string' || !value.business_url.startsWith(value.origin + '/business/')) throw new Error('business URL')
    if (typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(value.name)) throw new Error('name')
    for (const key of ['legal_name', 'accent', 'logo_url']) {
      if (value[key] !== null && typeof value[key] !== 'string') throw new Error(key)
    }
    return JSON.stringify({ version: 1, origin: value.origin, business_url: value.business_url,
      name: value.name, legal_name: value.legal_name, accent: value.accent, logo_url: value.logo_url })
  } catch {
    log('[pantry] No Business carry: local file is unreadable or invalid.')
    return null
  }
}
