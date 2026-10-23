import { inDimension, type DimensionScope } from './dimensions/scope'
// 1099 contractors: vendors a business pays for services, their payments per
// calendar year and the 1099-NEC figures due each January. Pantry applies the
// rules it can apply from its own records and files nothing with the IRS:
// - a payment counts in the calendar year of its payment date, unless reversed;
// - card and payment-network payments are left out, because the card processor
//   or network reports them on Form 1099-K (IRS 1099-NEC instructions);
// - check, ACH, wire and cash payments count in box 1;
// - a payment whose method was never recorded is shown apart until a person sets it.
// The reporting threshold is kept per tax year (One Big Beautiful Bill Act, 2025).
import { openTin, sealTin } from './contractor-tin'
import { authority, who, tinAuthority } from './access'
import { operatorAuth, runtimeBindings } from '../auth.server'
import { requireThat, text, uid, now, type Data } from './core'
import { all, audit, changed, guard, one, q, run, type Sql, type AuditActor } from './db'
import { contact } from './contacts'
import { requireEntity } from './settings'
import { STATES } from './states'
import type { Bindings } from '../auth.server'
import type { Command } from './context'

export const METHODS = ['check', 'ach', 'wire', 'cash', 'card', 'payment-network'] as const
const COUNTED = new Set(['check', 'ach', 'wire', 'cash']), EXCLUDED = new Set(['card', 'payment-network'])

/** The 1099-NEC threshold for payments made in a calendar year, and where it comes from. */
export function threshold(year: number) {
  if (year <= 2025) return { cents: 60000, note: '$600 for payments made in 2025 and earlier.' }
  if (year === 2026) return { cents: 200000, note: '$2,000 for payments made in 2026 (raised from $600 by the One Big Beautiful Bill Act).' }
  return { cents: 200000, note: `$2,000. The IRS adjusts this for inflation from 2027; Pantry has not been given the ${year} figure yet, so check the IRS instructions before filing.` }
}

const masked = (tin: string, kind: string) => kind === 'ein' ? `••-•••${tin.slice(-4)}` : `•••-••-${tin.slice(-4)}`

/** Every vendor's payments in a calendar year with the 1099-NEC figures they make; the report and its drill-through share it. */
export async function vendorYear(db: D1Database, year: number, dimension?: DimensionScope) {
  const from = `${year}-01-01`, to = `${year}-12-31`, limit = threshold(year)
  const vendors = await all(db, `SELECT c.id, c.name, c.is_1099, c.revision, t.legal_name, t.tin_kind, t.tin_last4, t.address, t.city, t.state, t.zip, t.backup_withholding, c.vendor_tax_box FROM pt_contacts c LEFT JOIN pt_contractor_tax t ON t.contact_id = c.id WHERE c.kind = 'vendor' ORDER BY c.name`)
  const payments = await all(db, "SELECT p.id,p.contact_id,p.payment_date,SUM(l.credit_cents-l.debit_cents) AS amount_cents,p.method,p.reference,p.reversal_id,l.class_name,l.location_name,l.project_name FROM pt_payments p JOIN pt_bank_accounts b ON b.id=p.bank_account_id JOIN pt_journal_lines l ON l.entry_id=p.journal_id AND l.account_id=b.account_id WHERE p.direction = 'paid' AND p.payment_date BETWEEN ? AND ? GROUP BY p.id,l.class_name,l.location_name,l.project_name ORDER BY p.payment_date,p.created_at,p.id", from, to)
  return vendors.map(v => {
    const whole = payments.filter(p => p.contact_id === v.id), selected=whole.filter(p=>inDimension(p,dimension)),grouped=new Map<string,Data>()
    for(const p of selected){const previous=grouped.get(p.id);if(previous)previous.amount_cents+=p.amount_cents;else grouped.set(p.id,{...p})}
    const own=[...grouped.values()]
    const wholeBox1=whole.filter(p=>!p.reversal_id&&COUNTED.has(p.method)).reduce((n,p)=>n+p.amount_cents,0),wholeUnknown=whole.filter(p=>!p.reversal_id&&p.method==='unrecorded').reduce((n,p)=>n+p.amount_cents,0)
    const live = own.filter(p => !p.reversal_id), sum = (f: (p: Data) => boolean) => live.filter(f).reduce((s, p) => s + p.amount_cents, 0)
    const box1 = sum(p => COUNTED.has(p.method)), excluded = sum(p => EXCLUDED.has(p.method)), unrecorded = sum(p => p.method === 'unrecorded')
    const missing = [!v.tin_last4 && 'TIN', !v.address && 'address'].filter(Boolean)
    return { id: v.id, name: v.name, is1099: !!v.is_1099, revision: v.revision,
      taxBox: v.vendor_tax_box, backupWithholding: !!v.backup_withholding, tax: v.tin_last4 ? { legalName: v.legal_name, tinKind: v.tin_kind, tin: masked(v.tin_last4, v.tin_kind), address: v.address, city: v.city, state: v.state, zip: v.zip } : null,
      box1, excluded, unrecorded, reversed: own.filter(p => p.reversal_id).reduce((s, p) => s + p.amount_cents, 0),
      ...(dimension?{wholeBox1,wholeUnknown}:{}), overThreshold: wholeBox1 >= limit.cents, mayReach: wholeBox1 < limit.cents && wholeBox1 + wholeUnknown >= limit.cents, missing,
      payments: own.map(p => ({ id: p.id, date: p.payment_date, amount: p.amount_cents, method: p.method, reference: p.reference, reversed: !!p.reversal_id, counts: !p.reversal_id && COUNTED.has(p.method), excluded: !p.reversal_id && EXCLUDED.has(p.method) })) }
  })
}

export async function contractors(db: D1Database, year: number, dimension?: DimensionScope) {
  const to = `${year}-12-31`, limit = threshold(year), list = await vendorYear(db, year, dimension)
  const today = new Date().toISOString().slice(0, 10)
  const marked = list.filter(v => v.is1099)
  return { ...(dimension?{dimension}:{}),basis: 'payment', year, threshold: limit.cents, thresholdNote: limit.note, yearEnded: today > to, dueBy: `${year + 1}-01-31`,
    contractors: marked, forms: marked.filter(v => v.overThreshold && v.taxBox === 'NEC-1').map(v => ({ id: v.id, name: v.tax?.legalName ?? v.name, tin: v.tax?.tin ?? null, box1: dimension?v.wholeBox1!:v.box1, box4: 0, ready: !v.missing.length && !v.backupWithholding })),
    otherBoxes: marked.filter(v => v.taxBox !== 'NEC-1').map(v => ({ id: v.id, name: v.name, taxBox: v.taxBox, paid: v.box1 })),
    // Vendors not marked as contractors who were paid enough by check, ACH, wire or cash to be worth a look.
    unmarked: list.filter(v => !v.is1099 && v.overThreshold).map(v => ({ id: v.id, name: v.name, box1: v.box1 })),
    vendors: list.filter(v => !v.is1099).map(v => ({ id: v.id, name: v.name })) }
}

export const necCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s }

/** Filing rows remain masked unless the caller supplies fresh disclosure authority. */
export async function necRows(db: D1Database, year: number, disclosure?: { env: Bindings; checks: Sql[] }) {
  const report = await contractors(db, year), entity = await requireEntity(db)
  requireThat(report.yearEnded, `The ${year} forms are ready after December 31, ${year}`, 409)
  const incomplete = report.forms.filter(f => !f.ready).map(f => f.name)
  requireThat(!incomplete.length, `Review filing details and backup withholding for ${incomplete.join(', ')} first`, 409)
  const tax = new Map((await all(db, 'SELECT * FROM pt_contractor_tax')).map(t => [t.contact_id, t]))
  const rows = [['Tax year', 'Form', 'Payer name', 'Payer state', 'Recipient account', 'Recipient name', 'Recipient TIN type', 'Recipient TIN', 'Address', 'City', 'State', 'ZIP', 'Box 1 nonemployee compensation', 'Box 4 federal income tax withheld', 'Basis']]
  for (const f of report.forms) {
    const t = tax.get(f.id)!
    const tin = disclosure ? await openTin(disclosure.env, f.id, t.tin) : null
    if (disclosure) disclosure.checks.push(guard('EXISTS (SELECT 1 FROM pt_contractor_tax t JOIN pt_contacts c ON c.id=t.contact_id WHERE t.contact_id=? AND t.revision=? AND t.tin=? AND c.erased_at IS NULL)', f.id, t.revision, t.tin))
    const identity = tin ? (t.tin_kind === 'ein' ? `${tin.slice(0, 2)}-${tin.slice(2)}` : `${tin.slice(0, 3)}-${tin.slice(3, 5)}-${tin.slice(-4)}`) : masked(t.tin_last4, t.tin_kind)
    rows.push([String(year), '1099-NEC', entity.legal_name, entity.state, f.id, t.legal_name, t.tin_kind.toUpperCase(), identity, t.address, t.city, t.state, t.zip, (f.box1 / 100).toFixed(2), '0.00', 'Payment basis'])
  }
  return rows

}

/** Mark a vendor as a 1099 contractor (or not) and keep its filing details. A blank TIN keeps the one on file. */
const saveContractor: Command = { need: 'record', async run(c, b) {
  const vendor = await contact(c.db, text(b.contactId, 'Vendor'), 'vendor')
  const is1099 = b.is1099 === true || b.is1099 === 'true' || b.is1099 === 'on'
  const statements: Sql[] = [authority(c.actor, 'record'), q('UPDATE pt_contacts SET is_1099 = ?, revision = ? WHERE id = ?', is1099 ? 1 : 0, uid(), vendor.id), changed()]
  const current = await one(c.db, 'SELECT * FROM pt_contractor_tax WHERE contact_id = ?', vendor.id)
  const details = ['legalName', 'tin', 'address', 'city', 'state', 'zip'].some(k => typeof b[k] === 'string' && b[k].trim())
  let last4 = current?.tin_last4 ?? null
  if (details) {
    const raw = typeof b.tin === 'string' ? b.tin.replace(/[\s-]/g, '') : ''
    requireThat(raw || current, 'Enter the TIN from the W-9')
    requireThat(!raw || /^\d{9}$/.test(raw), 'A TIN is nine digits (an SSN, ITIN or EIN)')
    const tinKind = text(b.tinKind, 'TIN type')
    requireThat(tinKind === 'ssn' || tinKind === 'ein', 'TIN type is SSN/ITIN or EIN')
    const state = text(b.state, 'State', 2).toUpperCase()
    requireThat(STATES.includes(state), 'Use the two-letter state code')
    const zip = text(b.zip, 'ZIP code', 10)
    requireThat(/^\d{5}(-\d{4})?$/.test(zip), 'ZIP code is 5 digits, or ZIP+4')
    const sealed = raw ? await sealTin(c.env, vendor.id, raw) : {tin: current!.tin, last4: current!.tin_last4, hash: current!.tin_hash}
    last4 = sealed.last4
    statements.push(q(`INSERT INTO pt_contractor_tax (contact_id, legal_name, tin_kind, tin, tin_last4, tin_hash, address, city, state, zip, revision, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (contact_id) DO UPDATE SET legal_name = excluded.legal_name, tin_kind = excluded.tin_kind, tin = excluded.tin, tin_last4 = excluded.tin_last4, tin_hash = excluded.tin_hash, address = excluded.address, city = excluded.city, state = excluded.state, zip = excluded.zip, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      vendor.id, text(b.legalName, 'Legal name (as on the W-9)', 200), tinKind, sealed.tin, sealed.last4, sealed.hash, text(b.address, 'Street address', 200), text(b.city, 'City', 100), state, zip, uid(), c.actor.email, now()))
  }
  if (b.backupWithholding !== undefined) {
    requireThat(c.actor.kind === 'person' && ['owner', 'accountant'].includes(c.actor.role), 'Only the owner or accountant records backup withholding', 403)
    requireThat(details || current, 'Save the contractor tax details first')
    statements.push(q('UPDATE pt_contractor_tax SET backup_withholding=? WHERE contact_id=?', b.backupWithholding === true || b.backupWithholding === 'on' ? 1 : 0, vendor.id), changed())
  }
  // The audit trail names what changed, never the TIN itself.
  statements.push(audit(who(c.actor), 'contractor.save', 'vendor', vendor.id, { is1099, details, tinLast4: details ? last4 : undefined, ...(b.backupWithholding !== undefined ? { backupWithholding: b.backupWithholding === true || b.backupWithholding === 'on' } : {}) }))
  await run(c.db, statements)
  return { id: vendor.id, is1099 }
} }

/** How a recorded payment was made. It changes no posting, only which 1099 it belongs on. */
const setMethod: Command = { need: 'record', async run(c, b) {
  const payment = await one(c.db, 'SELECT * FROM pt_payments WHERE id = ?', text(b.id, 'Payment'))
  requireThat(payment, 'Payment not found', 404)
  const method = text(b.method, 'Payment method')
  requireThat((METHODS as readonly string[]).includes(method), 'Payment method is check, ACH, wire, cash, card or a payment network')
  requireThat(method === 'check' || !await one(c.db, 'SELECT 1 FROM pt_checks WHERE payment_id = ?', payment.id), 'A numbered check keeps its check payment method', 409)
  requireThat(!payment.card_last4 || method === 'card', 'A payment from a card or line of credit keeps its card payment method')
  await run(c.db, [authority(c.actor, 'record'), q('UPDATE pt_payments SET method = ? WHERE id = ?', method, payment.id), changed(), audit(who(c.actor), 'payment.method', 'payment', payment.id, { from: payment.method, to: method })])
  return (await one(c.db, 'SELECT * FROM pt_payments WHERE id = ?', payment.id))!
} }

export const contractorCommands: Record<string, Command> = {
  'contractor.save': saveContractor,
  'contractor.step-up': { need: 'read', async run(c) {
    requireThat(c.actor.kind === 'person' && ['owner', 'accountant'].includes(c.actor.role) && !c.actor.policy?.maskTin, 'Only the owner or an unmasked accountant may reveal tax identity', 403)
    await operatorAuth(runtimeBindings(c.env)).requestStepUp(c.request, { action: 'export', returnTo: '/app/reports?report=contractors' })
    return { message: 'Check your sign-in email, confirm in this browser, then reveal the TIN within five minutes.' }
  } },
  'contractor.reveal': { need: 'read', async run(c,b) {
    const checks = await tinAuthority(c)
    const vendor = await contact(c.db, text(b.contactId, 'Vendor'), 'vendor')
    const tax = await one(c.db, 'SELECT tin, revision FROM pt_contractor_tax WHERE contact_id=?', vendor.id)
    requireThat(tax?.tin, 'No tax identity is on file', 404)
    const tin = await openTin(c.env, vendor.id, tax.tin)
    await run(c.db, [...checks, guard('EXISTS (SELECT 1 FROM pt_contractor_tax t JOIN pt_contacts c ON c.id=t.contact_id WHERE t.contact_id=? AND t.revision=? AND t.tin=? AND c.erased_at IS NULL)', vendor.id, tax.revision, tax.tin), audit(who(c.actor), 'contractor.tin-reveal', 'vendor', vendor.id, { revision: tax.revision })])
    return { tin }
  } },
  'payment.set-method': setMethod,
}
