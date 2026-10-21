import { Fault } from '../core'

/** Apply the same public-DNS-only policy at registration and at delivery. */
export function destination(raw: string): { destination: string; host: string } {
  const refused = () => new Fault(400, 'Webhook destination must be an HTTPS DNS hostname on port 443 without credentials or a fragment')
  if (typeof raw !== 'string' || raw.length > 4096 || /[\s\\#]/.test(raw) || !/^https:\/\//i.test(raw)) throw refused()
  let url: URL
  try { url = new URL(raw) } catch { throw refused() }
  const authority = raw.slice(raw.indexOf('//') + 2).split(/[/?]/, 1)[0]
  if (url.protocol !== 'https:' || url.port || url.username || url.password || authority.includes('@')) throw refused()
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const labels = host.split('.')
  if (host.length > 253 || labels.length < 2 || /^[\d.]+$/.test(host)
    || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || /(?:^|\.)(?:localhost|local|internal|arpa)$/.test(host)) throw refused()
  url.hostname = host
  return { destination: url.href, host }
}
