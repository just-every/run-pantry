import { Hono } from 'hono'
import { runtimeBindings, type Bindings } from '../auth.server'
import type { Command, Context } from './context'
import { authority, tinAuthority, who } from './access'
import { now, optionalText, requireThat, sha256, text, uid } from './core'
import { audit, changed, guard, one, q, run } from './db'
import { contact } from './contacts'
import { sealTin } from './contractor-tin'
import { seal, unseal } from './seal'
import { STATES } from './states'
import { vendorYear } from './contractors'

export const CERTIFICATION =
  'Under penalties of perjury, I certify that: (1) The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); (2) I am not subject to backup withholding because I am exempt, have not been notified by the IRS that I am subject to backup withholding as a result of a failure to report all interest or dividends, or the IRS has notified me that I am no longer subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; and (4) The FATCA codes entered on this form indicating that I am exempt from FATCA reporting are correct.'
const classes = [
  'individual',
  'c-corporation',
  's-corporation',
  'partnership',
  'trust-estate',
  'llc',
  'other',
]
function manager(c: Context) {
  requireThat(
    c.actor.kind === 'person' && c.actor.role === 'owner',
    'Only the owner manages W-9 requests',
    403,
  )
}
export async function w9Status(db: D1Database, id: string) {
  const tax = await one(db, 'SELECT w9_completed_at,erased_at FROM pt_contractor_tax WHERE contact_id=?', id)
  const pending = await one(
    db,
    'SELECT r.id,r.expires_at FROM pt_w9_requests r JOIN pt_contacts c ON c.id=r.contact_id LEFT JOIN pt_contractor_tax t ON t.contact_id=r.contact_id WHERE r.contact_id=? AND r.token_hash IS NOT NULL AND r.completed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at>? AND c.revision=r.contact_revision AND c.erased_at IS NULL AND t.revision IS r.tax_revision ORDER BY r.created_at DESC LIMIT 1',
    id,
    now(),
  )
  return {
    status: tax?.w9_completed_at && !tax.erased_at ? 'complete' : pending ? 'requested' : 'missing',
    completedAt: tax?.w9_completed_at ?? null,
    contactRevision: (await one(db, 'SELECT revision FROM pt_contacts WHERE id=?', id))?.revision,
    request: pending,
  }
}
export async function missingW9(db: D1Database, year: number) {
  const vendors = await vendorYear(db, year)
  return (
    await Promise.all(
      vendors.map(async (v) => ({
        id: v.id,
        name: v.name,
        revision: v.revision,
        payments: v.payments,
        w9: await w9Status(db, v.id),
      })),
    )
  ).filter((v) => v.payments.some((p) => !p.reversed && p.amount > 0) && v.w9.status !== 'complete')
}
const requestW9: Command = {
  need: 'owner',
  async run(c, b) {
    manager(c)
    requireThat(b.consent === true, 'Confirm that you intend to share a private W-9 request link')
    const v = await contact(c.db, text(b.contactId, 'Vendor'), 'vendor'),
      id = uid(),
      token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
        v.toString(16).padStart(2, '0'),
      ).join('')
    requireThat(b.contactRevision === v.revision, 'Review the current vendor before approving this exact W-9 request', 409)
    const tax = await one(c.db, 'SELECT revision FROM pt_contractor_tax WHERE contact_id=?', v.id),
      expires = new Date(Date.now() + 14 * 86400000).toISOString()
    await run(c.db, [
      authority(c.actor, 'owner'),
      guard(
        'EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND revision=? AND erased_at IS NULL)',
        v.id,
        v.revision,
      ),
      q(
        'UPDATE pt_w9_requests SET token_hash=NULL,revoked_at=? WHERE contact_id=? AND token_hash IS NOT NULL',
        now(),
        v.id,
      ),
      q(
        'INSERT INTO pt_w9_requests(id,contact_id,token_hash,tax_revision,contact_revision,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',
        id,
        v.id,
        await sha256(token),
        tax?.revision ?? null,
        v.revision,
        expires,
        now(),
      ),
      audit(who(c.actor), 'w9.request', 'vendor', v.id, { requestId: id, contactRevision: v.revision, expiresAt: expires, consent: true }),
    ])
    return { id, url: `${new URL(c.request.url).origin}/w9/${token}`, expiresAt: expires }
  },
}
const revokeW9: Command = {
  need: 'owner',
  async run(c, b) {
    manager(c)
    const v = await contact(c.db, text(b.contactId, 'Vendor'), 'vendor')
    await run(c.db, [
      authority(c.actor, 'owner'),
      q(
        'UPDATE pt_w9_requests SET token_hash=NULL,revoked_at=? WHERE contact_id=? AND token_hash IS NOT NULL',
        now(),
        v.id,
      ),
      audit(who(c.actor), 'w9.revoke', 'vendor', v.id),
    ])
    return w9Status(c.db, v.id)
  },
}
const evidence: Command = {
  need: 'read',
  async run(c, b) {
    manager(c)
    const checks = await tinAuthority(c),
      v = await contact(c.db, text(b.contactId, 'Vendor'), 'vendor'),
      t = await one(
        c.db,
        'SELECT revision,w9_evidence_sealed FROM pt_contractor_tax WHERE contact_id=? AND erased_at IS NULL',
        v.id,
      )
    requireThat(t?.w9_evidence_sealed, 'No W-9 evidence on file', 404)
    const opened = await unseal(c.env.SESSION_SECRET, `w9:${v.id}`, t.w9_evidence_sealed)
    requireThat(opened, 'W-9 evidence cannot be opened with this installation secret', 409)
    await run(c.db, [
      ...checks,
      guard(
        'EXISTS(SELECT 1 FROM pt_contractor_tax WHERE contact_id=? AND revision=? AND erased_at IS NULL)',
        v.id,
        t.revision,
      ),
      audit(who(c.actor), 'w9.evidence-reveal', 'vendor', v.id),
    ])
    return { evidence: JSON.parse(opened) }
  },
}
export const w9Commands: Record<string, Command> = {
  'w9.request': requestW9,
  'w9.revoke': revokeW9,
  'w9.evidence': evidence,
}
async function byToken(env: Bindings, token: string) {
  requireThat(/^[a-f0-9]{64}$/.test(token), 'This W-9 request is closed', 404)
  const row = await one(
    env.DB,
    'SELECT r.* FROM pt_w9_requests r JOIN pt_contacts c ON c.id=r.contact_id WHERE r.token_hash=? AND r.completed_at IS NULL AND r.revoked_at IS NULL AND r.expires_at>? AND c.erased_at IS NULL AND c.active=1 AND c.revision=r.contact_revision',
    await sha256(token),
    now(),
  )
  requireThat(row, 'This W-9 request is closed', 404)
  return row
}
async function boundedForm(request: Request) {
  requireThat(
    request.headers.get('content-type')?.split(';')[0] === 'application/x-www-form-urlencoded',
    'Submit the W-9 form',
    415,
  )
  const reader = request.body?.getReader()
  requireThat(reader, 'W-9 fields are required')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 20000) {
      await reader.cancel()
      requireThat(false, 'W-9 submission is too large', 413)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return Object.fromEntries(new URLSearchParams(new TextDecoder().decode(bytes)))
}
const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const field = (label: string, name: string, required = true) =>
  `<label>${escape(label)}<input name="${name}" ${required ? 'required' : ''} maxlength="200" autocomplete="off"></label>`
export const w9Public = new Hono<{ Bindings: Bindings }>()
w9Public.use('/w9/*', async (c, next) => {
  await next()
  c.header('cache-control', 'no-store')
  c.header('referrer-policy', 'strict-origin')
  c.header('x-content-type-options', 'nosniff')
  c.header(
    'content-security-policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  )
})
w9Public.get('/w9/:token', async (c) => {
  await byToken(c.env, c.req.param('token'))
  return c.html(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Private W-9 request</title><style>body{font:16px system-ui;color:#173530;background:#f8f7f2;margin:0;padding:24px}main{max-width:680px;margin:auto}label{display:block;margin:18px 0}input,select,button{box-sizing:border-box;font:inherit;padding:12px;width:100%;border:1px solid #80978d;border-radius:8px}input[type=checkbox]{width:auto}button{background:#173f36;color:white}p{line-height:1.5}</style><main><h1>Form W-9</h1><p>Request for Taxpayer Identification Number and Certification · IRS March 2024. Give this form to the requester. Do not send it to the IRS.</p><p><a href="https://www.irs.gov/pub/irs-pdf/fw9.pdf" rel="noreferrer">Read the IRS form and instructions</a>. This private link expires in 14 days and closes after submission.</p><form method="post">${field('1. Name of entity or individual (required on your income tax return)', 'legalName')}${field('2. Business name or disregarded entity name, if different', 'businessName', false)}<label>3a. Federal tax classification<select name="classification" required>${classes.map((v) => `<option value="${v}">${v}</option>`).join('')}</select></label>${field('LLC tax classification (C, S or P); or describe Other', 'classificationDetail', false)}<label><input type="checkbox" name="foreignPartners" value="yes">3b. Partnership, trust, estate or LLC classified as partnership with foreign partners, owners or beneficiaries (see instructions)</label>${field('4. Exempt payee code (if any)', 'exemptPayee', false)}${field('Exemption from FATCA reporting code (if any)', 'fatca', false)}${field('5. Address (number, street, and apartment or suite)', 'address')}${field('6. City', 'city')}${field('State (two letters)', 'state')}${field('ZIP code', 'zip')}${field('Requester name and address (optional)', 'requester', false)}${field('7. Account numbers (optional)', 'accounts', false)}<h2>Part I · Taxpayer identification number</h2><label>TIN type<select name="tinKind"><option value="ssn">SSN or ITIN</option><option value="ein">EIN</option></select></label>${field('Taxpayer identification number (nine digits)', 'tin')}<h2>Part II · Certification</h2><p>${CERTIFICATION}</p><label><input type="checkbox" name="backupWithholding" value="yes">The IRS has notified me that I am currently subject to backup withholding. I cross out item (2) above.</label><p>The IRS does not require your consent to any provision of this document other than the certifications required to avoid backup withholding.</p><label><input type="checkbox" name="certify" value="yes" required>I certify the statements above, with item (2) excluded if checked, and consent to sign and deliver this W-9 electronically.</label>${field('Signature (type your full name)', 'signature')}<p>The server records the submission date and exact certification. Your tax identity is encrypted and ordinary staff views show only the last four digits.</p><button type="submit">Sign and submit W-9</button></form><form method="post" action="/w9/${c.req.param('token')}/opt-out"><p>Prefer no further W-9 email?</p><button type="submit">Opt out of W-9 email</button></form></main></html>`,
  )
})
w9Public.post('/w9/:token', async (c) => {
  requireThat(
    c.req.header('origin') === runtimeBindings(c.env).AUTH_ORIGIN &&
      c.req.header('sec-fetch-site') !== 'cross-site',
    'Invalid origin',
    403,
  )
  requireThat(Number(c.req.header('content-length') ?? 0) <= 20000, 'W-9 submission is too large', 413)
  const r = await byToken(c.env, c.req.param('token')),
    b = await boundedForm(c.req.raw)
  requireThat(b.certify === 'yes', 'Certification and electronic signature consent are required')
  const data: Record<string, any> = {}
  for (const key of [
    'legalName',
    'address',
    'city',
    'state',
    'zip',
    'tinKind',
    'signature',
    'classification',
  ])
    data[key] = text(b[key], key, 200)
  for (const key of ['businessName', 'classificationDetail', 'exemptPayee', 'fatca', 'requester', 'accounts'])
    data[key] = optionalText(b[key], key, 200)
  data.tin = text(b.tin, 'TIN', 20).replace(/[ -]/g, '')
  requireThat(/^\d{9}$/.test(data.tin), 'TIN must be nine digits')
  requireThat(
    ['ein', 'ssn'].includes(data.tinKind) && classes.includes(data.classification),
    'Choose a TIN type and classification',
  )
  requireThat(
    data.classification !== 'llc' || ['C', 'S', 'P'].includes(data.classificationDetail),
    'Enter LLC classification C, S or P',
  )
  requireThat(
    data.classification !== 'other' || data.classificationDetail,
    'Describe the other classification',
  )
  data.state = data.state.toUpperCase()
  requireThat(
    STATES.includes(data.state) && /^\d{5}(-\d{4})?$/.test(data.zip),
    'Enter a US state and ZIP code',
  )
  data.foreignPartners = b.foreignPartners === 'yes'
  data.backupWithholding = b.backupWithholding === 'yes'
  data.certification = CERTIFICATION
  data.certifiedAt = now()
  data.electronicConsent = true
  const sealed = await sealTin(c.env, r.contact_id, data.tin),
    proof = await seal(c.env.SESSION_SECRET, `w9:${r.contact_id}`, JSON.stringify(data)),
    revision = uid()
  await run(c.env.DB, [
    guard(
      'EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND revision=? AND erased_at IS NULL AND active=1)',
      r.contact_id,
      r.contact_revision,
    ),
    guard('(SELECT revision FROM pt_contractor_tax WHERE contact_id=?) IS ?', r.contact_id, r.tax_revision),
    q(
      'UPDATE pt_w9_requests SET token_hash=NULL,completed_at=? WHERE id=? AND token_hash=? AND expires_at>? AND revoked_at IS NULL AND completed_at IS NULL',
      now(),
      r.id,
      await sha256(c.req.param('token')),
      now(),
    ),
    changed(),
    q(
      "UPDATE pt_contractor_tax SET w9_evidence_history=json_insert(w9_evidence_history,'$[#]',w9_evidence_sealed) WHERE contact_id=? AND w9_evidence_sealed IS NOT NULL",
      r.contact_id,
    ),
    q(
      `INSERT INTO pt_contractor_tax(contact_id,legal_name,tin_kind,tin,tin_last4,tin_hash,address,city,state,zip,revision,updated_by,updated_at,backup_withholding,w9_evidence_sealed,w9_completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(contact_id) DO UPDATE SET legal_name=excluded.legal_name,tin_kind=excluded.tin_kind,tin=excluded.tin,tin_last4=excluded.tin_last4,tin_hash=excluded.tin_hash,address=excluded.address,city=excluded.city,state=excluded.state,zip=excluded.zip,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at,backup_withholding=excluded.backup_withholding,w9_evidence_sealed=excluded.w9_evidence_sealed,w9_completed_at=excluded.w9_completed_at`,
      r.contact_id,
      data.legalName,
      data.tinKind,
      sealed.tin,
      sealed.last4,
      sealed.hash,
      data.address,
      data.city,
      data.state,
      data.zip,
      revision,
      'vendor:w9',
      now(),
      data.backupWithholding ? 1 : 0,
      proof,
      now(),
    ),
    audit({ kind: 'system', email: 'vendor:w9' }, 'w9.complete', 'vendor', r.contact_id, {
      requestId: r.id,
      certifiedAt: data.certifiedAt,
    }),
  ])
  return c.html(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>W-9 received</title><main><h1>W-9 received</h1><p>Your signed certification is saved. This request link is now closed. You can close this window.</p></main></html>',
  )
})

w9Public.post('/w9/:token/opt-out', async c => {
  requireThat(c.req.header('origin') === runtimeBindings(c.env).AUTH_ORIGIN && c.req.header('sec-fetch-site') !== 'cross-site', 'Invalid origin',403)
  const r = await byToken(c.env,c.req.param('token'))
  await run(c.env.DB,[q('INSERT OR IGNORE INTO pt_tax_vendor_stops(contact_id,at) VALUES(?,?)',r.contact_id,now()),q('UPDATE pt_w9_requests SET token_hash=NULL,revoked_at=? WHERE contact_id=?',now(),r.contact_id),audit({kind:'system',email:'vendor:w9'},'tax-reminders.vendor-opt-out','vendor',r.contact_id)])
  return c.html('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>W-9 email stopped</title><style>body{font:16px system-ui;color:#173530;background:#f8f7f2;margin:0;padding:24px}main{max-width:680px;margin:auto}p{line-height:1.5}</style><main><h1>W-9 email stopped</h1><p>Your opt-out is recorded. No more W-9 request or reminder email will be sent.</p></main></html>')
})
