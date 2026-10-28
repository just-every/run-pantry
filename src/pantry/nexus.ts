// Economic nexus watch: sales and transactions by destination state over each
// state's measuring period, compared with the versioned threshold table. Due
// work raises one alert per state and level (80% and 100%) to the owner and
// every active accountant; the alert resolves when the measure falls back
// below its level and can be raised again later. Whether to register is the
// accountant's decision, recorded here with the figures it was made on.
import { runtimeBindings, type Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { authority, ownerEmail, pantry, who } from './access'
import { addDays, now, requireThat, text, uid, usd, type Data } from './core'
import { all, audit, guard, q, run } from './db'
import { accountants } from './questions/accountant'
import { businessDay, sendingSettings } from './delivery'
import { NEXUS_NOTE, NEXUS_VERSION, NO_STATE_TAX, THRESHOLDS, type Threshold } from './nexus-thresholds'
import type { Command } from './context'

export const DECISIONS = { register: 'Register to collect', 'not-required': 'Registration not required', monitor: 'Keep watching' } as const
type Window = { label: string; from: string; to: string }

function shiftMonths(day: string, months: number) {
  const d = new Date(day + 'T00:00:00Z'), target = d.getUTCMonth() + months
  d.setUTCDate(1); d.setUTCMonth(target)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(Number(day.slice(8, 10)), last))
  return d.toISOString().slice(0, 10)
}

/** The completed measuring period and the one in progress (to today), per the state's measure. */
export function windows(t: Threshold, today: string): Window[] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  if (t.measure === 'calendar') return [{ label: `Calendar year ${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }, { label: `Calendar year ${y} to date`, from: `${y}-01-01`, to: today }]
  if (t.measure === 'trailing-12') return [{ label: '12 months to date', from: addDays(shiftMonths(today, -12), 1), to: today }]
  const start = t.measure === 'ny-quarters'
    ? (m <= 2 ? `${y - 1}-12-01` : `${y}-${String(m - (m % 3)).padStart(2, '0')}-01`)
    : (m >= 10 ? `${y}-10-01` : `${y - 1}-10-01`)
  const name = t.measure === 'ny-quarters' ? 'Four quarters' : '12 months'
  return [{ label: `${name} ${shiftMonths(start, -12)} to ${addDays(start, -1)}`, from: shiftMonths(start, -12), to: addDays(start, -1) },
    { label: `${name} to date`, from: shiftMonths(start, t.measure === 'ny-quarters' ? -9 : 0), to: today }]
}

/** Share of the threshold reached, in basis points: either figure for `or`, the lesser for `and`. */
function reached(t: Threshold, sales: number, transactions: number) {
  const s = Math.floor(sales * 10000 / t.sales), n = t.transactions ? Math.floor(transactions * 10000 / t.transactions) : 0
  return t.test === 'sales' ? s : t.test === 'or' ? Math.max(s, n) : Math.min(s, n)
}

/** Issued invoice and credit lines summed by destination state, issue day and kind; write-off credits
 *  (ACCT-003) are bad debts, not returns, so they never reduce gross sales. A line's
 *  destination is its document's ship-to state, then (for a credit) its invoice's, then the state
 *  of the tax code chosen on the line. An invoice is one transaction in each state it ships to. */
async function saleDays(db: D1Database, from: string) {
  return all(db, `SELECT state, issue_date, kind, SUM(amount_cents) AS amount, COUNT(DISTINCT id) AS documents FROM (
      SELECT i.id, i.kind, i.issue_date, l.amount_cents - l.discount_cents AS amount_cents, COALESCE(NULLIF(i.destination_state, ''), NULLIF(o.destination_state, ''), t.state, '') AS state
      FROM pt_invoice_lines l JOIN pt_invoices i ON i.id = l.invoice_id
      LEFT JOIN pt_invoices o ON o.id = i.credit_for
      LEFT JOIN pt_tax_codes t ON t.id = COALESCE(l.chosen_tax_code, l.tax_code)
      WHERE i.status = 'issued' AND i.journal_id IS NOT NULL AND i.write_off = 0 AND i.early_discount = 0 AND i.issue_date >= ?)
    GROUP BY state, issue_date, kind`, from)
}

export async function nexusWatch(db: D1Database) {
  const today = businessDay((await sendingSettings(db)).time_zone)
  const days = await saleDays(db, `${Number(today.slice(0, 4)) - 2}-01-01`)
  const sum = (rows: Data[]) => ({ sales: rows.reduce((s, d) => s + (d.kind === 'credit' ? -1 : 1) * d.amount, 0), documents: rows.reduce((s, d) => s + d.documents, 0) })
  const measure = (state: string, w: Window) => {
    const inWindow = days.filter(d => d.state === state && d.issue_date >= w.from && d.issue_date <= w.to)
    return { sales: sum(inWindow).sales, transactions: sum(inWindow.filter(d => d.kind === 'invoice')).documents }
  }
  const alerts = await all(db, 'SELECT * FROM pt_nexus_alerts ORDER BY raised_at DESC, level DESC')
  const decisions = await all(db, 'SELECT * FROM pt_nexus_decisions ORDER BY decided_at DESC, id')
  const states = THRESHOLDS.map(t => {
    const measured = windows(t, today).map(w => { const f = measure(t.state, w); return { ...w, ...f, reached: reached(t, f.sales, f.transactions) } })
    const top = measured.reduce((a, b) => b.reached > a.reached ? b : a)
    const { sales: thresholdSales, transactions: thresholdTransactions, ...rule } = t
    return { ...rule, thresholdSales, thresholdTransactions, version: NEXUS_VERSION, windows: measured, sales: top.sales, transactions: top.transactions, period: top.label, reached: top.reached,
      level: top.reached >= 10000 ? 100 : top.reached >= 8000 ? 80 : 0,
      alerts: alerts.filter(a => a.state === t.state), decision: decisions.find(d => d.state === t.state) ?? null, decisions: decisions.filter(d => d.state === t.state) }
  }).sort((a, b) => b.reached - a.reached || a.state.localeCompare(b.state))
  // Lines with no ship-to state and no state on their tax code, since the start of last year: the owner fixes these.
  const unassigned = sum(days.filter(d => !d.state && d.issue_date >= `${Number(today.slice(0, 4)) - 1}-01-01`))
  return { today, version: NEXUS_VERSION, note: NEXUS_NOTE, noStateTax: NO_STATE_TAX, states,
    unassigned }
}

const escape = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))

/** Due work: raise new 80%/100% alerts once, email them, and resolve alerts no longer reached. */
export async function runNexusAlerts(env: Bindings, db: D1Database) {
  const watch = await nexusWatch(db), stamp = now()
  for (const s of watch.states) {
    await run(db, [q('UPDATE pt_nexus_alerts SET resolved_at = ? WHERE state = ? AND resolved_at IS NULL AND level > ?', stamp, s.state, s.level)])
    for (const level of [80, 100].filter(l => l <= s.level)) {
      const id = uid()
      const claim = await db.prepare(`INSERT OR IGNORE INTO pt_nexus_alerts (id, state, level, period, sales_cents, transactions, threshold_version, raised_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, s.state, level, s.period, s.sales, s.transactions, NEXUS_VERSION, stamp).run()
      if (claim.meta.changes !== 1) continue
      const bindings = runtimeBindings(env), mailer = operatorMail(bindings)
      const to = [...new Set([await ownerEmail(db, env), ...(await accountants(db)).map(a => a.email)].filter(Boolean))]
      const threshold = `sales ${usd(s.sales)} of ${usd(s.thresholdSales)}, ${s.transactions} invoices${s.thresholdTransactions ? ` of ${s.thresholdTransactions}` : ''}`
      let status = 'in-app', detail = 'The alert is shown in Books › Sales tax.'
      if (mailer && to.length && bindings.MAIL_FROM) {
        const body = `${s.state} economic nexus: ${level === 100 ? 'threshold reached' : '80% of the threshold reached'}.\n\n${s.period}: ${threshold} (${s.test === 'and' ? 'both' : s.test === 'or' ? 'either' : 'sales'} test, ${s.rule.toLowerCase()}).\nThreshold table ${NEXUS_VERSION}; source: ${s.source}.\n\nWhether to register is your accountant's decision, recorded in Pantry: ${bindings.AUTH_ORIGIN}/app/books (Sales tax tab)\n`
        try {
          const sent = await mailer.send({ deliveryId: `nexus-${id}`, from: bindings.MAIL_FROM, to, subject: `Pantry: ${s.state} sales at ${level}% of the economic-nexus threshold`, text: body, html: `<pre>${escape(body)}</pre>`, headers: {} }) as Data
          status = sent.status; detail = sent.providerMessageId ?? sent.status
        } catch { status = 'failed'; detail = 'Mail could not be sent; the alert remains visible in Pantry.' }
      }
      await run(db, [q('UPDATE pt_nexus_alerts SET recipients = ?, email_status = ?, email_detail = ? WHERE id = ?', JSON.stringify(to), status, detail, id),
        audit(pantry('reminders'), 'nexus.alert', 'nexus', s.state, { level, period: s.period, sales: s.sales, transactions: s.transactions, version: NEXUS_VERSION, status })])
    }
  }
}

/** The accountant records whether the business registers in a state, with the figures in front of them. */
const decide: Command = { need: 'record', async run(c, b) {
  requireThat(c.actor.kind === 'person' && c.actor.role === 'accountant', 'Whether to register is the accountant’s decision; an invited accountant records it', 403)
  const state = text(b.state, 'State', 2).toUpperCase(), decision = text(b.decision, 'Decision', 20)
  requireThat(Object.hasOwn(DECISIONS, decision), `Choose one of: ${Object.values(DECISIONS).join(', ')}`)
  const note = text(b.note, 'Reason', 2000)
  const s = (await nexusWatch(c.db)).states.find(x => x.state === state)
  requireThat(s, 'Choose a state on the economic nexus watch', 404)
  const id = uid()
  await run(c.db, [authority(c.actor, 'record'), guard("EXISTS (SELECT 1 FROM pt_members WHERE email = ? AND role = 'accountant' AND active = 1)", c.actor.email),
    q(`INSERT INTO pt_nexus_decisions (id, state, decision, note, period, sales_cents, transactions, reached_bp, threshold_version, decided_by, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, state, decision, note, s.period, s.sales, s.transactions, s.reached, NEXUS_VERSION, c.actor.email, now()),
    audit(who(c.actor), 'nexus.decide', 'nexus', state, { decision, note, period: s.period, sales: s.sales, transactions: s.transactions, version: NEXUS_VERSION })])
  return nexusWatch(c.db)
} }

export const nexusCommands: Record<string, Command> = { 'nexus.decide': decide }
