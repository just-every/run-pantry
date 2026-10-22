import { dimensionTags, dimensionRefusal } from './dimensions'
// Bank rules: the business's own instructions for filing routine statement
// lines. A rule names conditions (payee, description text, amount, direction,
// bank account) and how a matching line is filed (one category or a split, a
// contact, a tax code, a memo). Filing posts a balanced bank entry and matches
// the line to it, marked with the rule; undo reverses that entry. Rules never
// file a line in a locked month or inside a reconciled statement period.
import { bankAuthority, standingAuthority, standingFence } from './access-policy/banks'
import { recordedPaymentCandidates } from './recorded-payments'
import { depositProposals } from './automatch'
import { authority, who } from './access'
import { cents, Fault, now, optionalText, requireThat, scale, text, uid, type Data } from './core'
import { all, audit, changed, guard, one, periodOpen, q, run, type AuditActor, type Sql } from './db'
import { entryStatements, reversalStatements, entry } from './journal'
import type { Command, Context } from './context'

export type Split = { accountId: string; share?: number; amountCents?: number }
export type Rule = Data & { id: string; name: string; splits: Split[] }
/** Who files: the person who triggered it, or for a feed sync, the rule's author. */
export type Filer = { actor: AuditActor; authority: Sql }

const NOISE = new Set(['POS', 'DEBIT', 'CREDIT', 'CARD', 'CHECKCARD', 'PURCHASE', 'ACH', 'ONLINE', 'RECURRING', 'VISA', 'THE', 'WWW', 'COM', 'INC', 'LLC', 'CO', 'PAYMENT', 'TO', 'FROM'])
const words = (s: string) => ' ' + String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() + ' '
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())

/** The payee a line is filed under: the feed's merchant, else the first telling word of its description. */
export function payeeKey(line: Data) {
  if (String(line.payee ?? '').trim()) return words(line.payee).trim()
  return words(line.description).trim().split(' ').find(w => w.length > 1 && !/^\d+$/.test(w) && !NOISE.has(w)) ?? ''
}

export function ruleMatches(rule: Data, line: Data) {
  const conditions=typeof rule.dimension_conditions==='string'?JSON.parse(rule.dimension_conditions):rule.dimension_conditions??{}
  const tags=dimensionTags(line)
  for(const [key,value] of Object.entries(conditions))if(value&&tags[key as keyof typeof tags]!==value)return false
  if (rule.bank_account_id && rule.bank_account_id !== line.bank_account_id) return false
  if (rule.direction === 'out' && line.amount_cents > 0) return false
  if (rule.direction === 'in' && line.amount_cents < 0) return false
  if (rule.payee && ![line.payee, line.description].some(t => t && words(t).includes(words(rule.payee)))) return false
  if (rule.description_contains) {
    const description = String(line.description).toLowerCase(), condition = String(rule.description_contains).toLowerCase()
    if (rule.description_mode === 'equals' ? description !== condition : !description.includes(condition)) return false
  }
  const abs = Math.abs(line.amount_cents)
  if (rule.amount_min_cents && abs < rule.amount_min_cents) return false
  if (rule.amount_max_cents && abs > rule.amount_max_cents) return false
  return true
}

/** Basis points from a percentage like "60" or "33.33". */
function share(value: unknown, label: string) {
  const raw = String(value ?? '').trim()
  requireThat(/^\d{1,3}(\.\d{1,2})?$/.test(raw), `${label} is a percentage like 60 or 33.33`)
  const [w, f = ''] = raw.split('.')
  const n = Number(w) * 100 + Number(f.padEnd(2, '0'))
  requireThat(n > 0 && n <= 10000, `${label} is between 0.01 and 100`)
  return n
}

async function ruleInput(db: D1Database, b: Data) {
  const optionalCents = (v: unknown, label: string) => v === undefined || v === null || v === '' ? null : cents(v, label)
  const r = {
    dimensionConditions:dimensionTags(b.dimensionConditions??{}),
    dimensionActions:Object.fromEntries(Object.entries(dimensionTags(b.dimensionActions??{})).filter(([key,value])=>value&&(b.dimensionActions??{})[key]!==undefined)),
    name: text(b.name, 'Rule name', 120),
    priority: b.priority === undefined || b.priority === '' ? null : Number(b.priority),
    mode: optionalText(b.mode, 'Rule mode') || 'automatic',
    descriptionMode: optionalText(b.descriptionMode, 'Description match') || 'contains',
    splitMode: optionalText(b.splitMode, 'Split type') || 'percent',
    bankAccountId: b.bankAccountId ? text(b.bankAccountId, 'Bank account') : null,
    direction: optionalText(b.direction, 'Money in or out') || 'any',
    payee: optionalText(b.payee, 'Payee', 120),
    descriptionContains: optionalText(b.descriptionContains, 'Description text', 120),
    amountMin: optionalCents(b.amountMin, 'Smallest amount'),
    amountMax: optionalCents(b.amountMax, 'Largest amount'),
    contactId: b.contactId ? text(b.contactId, 'Contact') : null,
    taxCodeId: b.taxCodeId ? text(b.taxCodeId, 'Tax code') : null,
    memo: optionalText(b.memo, 'Memo', 300),
    splits: [] as Split[],
  }
  requireThat(r.priority === null || ((typeof b.priority === 'number' || typeof b.priority === 'string') && Number.isSafeInteger(r.priority) && r.priority >= 0), 'Priority is a nonnegative whole number')
  requireThat(['automatic', 'suggest'].includes(r.mode), 'Rule mode is automatic or suggest')
  requireThat(['contains', 'equals'].includes(r.descriptionMode), 'Description match is contains or equals')
  requireThat(['percent', 'amount'].includes(r.splitMode), 'Split type is percent or amount')
  requireThat(['out', 'in', 'any'].includes(r.direction), 'Money in or out is "out", "in" or "any"')
  requireThat(r.payee || r.descriptionContains || r.amountMin || r.amountMax ||Object.values(r.dimensionConditions).some(Boolean), 'Give the rule a payee, description text or amount to match')
  requireThat(!r.amountMin || !r.amountMax || r.amountMin <= r.amountMax, 'The smallest amount is more than the largest')
  if (r.bankAccountId) requireThat(await one(db, 'SELECT 1 FROM pt_bank_accounts WHERE id = ?', r.bankAccountId), 'Bank account not found', 404)
  const raw = Array.isArray(b.splits) && b.splits.length ? b.splits : [{ accountId: b.accountId, percent: '100' }]
  requireThat(raw.length <= 10, 'A rule splits into at most 10 categories')
  r.splits = raw.map((s: Data, i: number) => {
    const accountId = text(s.accountId, raw.length > 1 ? `Split ${i + 1} category` : 'Category')
    requireThat(r.splitMode === 'amount' ? s.percent === undefined || s.percent === '' : s.amount === undefined || s.amount === '', 'Use either amounts or percentages for all splits')
    return r.splitMode === 'amount' ? { accountId, amountCents: cents(s.amount, `Split ${i + 1} amount`) } : { accountId, share: share(s.percent, `Split ${i + 1} percentage`) }
  })
  if (r.splitMode === 'percent') requireThat(r.splits.reduce((n, s) => n + s.share!, 0) === 10000, 'Split percentages add up to 100')
  else requireThat(Number.isSafeInteger(r.splits.reduce((n, s) => n + s.amountCents!, 0)), 'Split amounts are too large')
  requireThat(new Set(r.splits.map(s => s.accountId)).size === r.splits.length, 'Each split uses a different category')
  const accounts = new Map((await all(db, 'SELECT id, name, subtype, active FROM pt_accounts')).map(a => [a.id, a]))
  for (const s of r.splits) {
    const a = accounts.get(s.accountId)
    requireThat(a && a.active && !['bank', 'receivable', 'payable'].includes(a.subtype), 'Choose an income, expense or other active category')
  }
  if (r.contactId) requireThat(await one(db, 'SELECT 1 FROM pt_contacts WHERE id = ? AND active = 1', r.contactId), 'Contact not found', 404)
  if (r.taxCodeId) requireThat(await one(db, 'SELECT 1 FROM pt_tax_codes WHERE id = ? AND active = 1', r.taxCodeId), 'Tax code not found', 404)
  const refusal=await dimensionRefusal(db,[],r.dimensionActions)??await dimensionRefusal(db,[],r.dimensionConditions)
  requireThat(!refusal,refusal??'Invalid dimension actions',409)
  return r
}

/** The rule as stored, from input (for previews of a rule not yet saved). */
const asRow = (r: Awaited<ReturnType<typeof ruleInput>>, extra: Data = {}): Rule => ({ id: '', name: r.name, bank_account_id: r.bankAccountId, direction: r.direction, payee: r.payee, description_contains: r.descriptionContains, amount_min_cents: r.amountMin, amount_max_cents: r.amountMax, contact_id: r.contactId, tax_code_id: r.taxCodeId, memo: r.memo, splits: r.splits, priority: r.priority, mode: r.mode, description_mode: r.descriptionMode, split_mode: r.splitMode,dimension_conditions:r.dimensionConditions,dimension_actions:r.dimensionActions, ...extra })

export async function rules(db: D1Database, { active = true } = {}): Promise<Rule[]> {
  return (await all(db, `SELECT * FROM pt_bank_rules ${active ? 'WHERE active = 1' : ''} ORDER BY priority, created_at, id`)).map(r => ({ ...r, id:r.id,name:r.name,splits: JSON.parse(r.splits),dimension_conditions:JSON.parse(r.dimension_conditions),dimension_actions:JSON.parse(r.dimension_actions) })) as Rule[]
}

const precedes = (a: Rule, b: Rule) => a.priority - b.priority || (String(a.created_at) < String(b.created_at) ? -1 : String(a.created_at) > String(b.created_at) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const splitHold = (rule: Rule, line: Data) => rule.split_mode === 'amount' && rule.splits.reduce((n, s) => n + s.amountCents!, 0) !== Math.abs(line.amount_cents) ? 'Split amounts must equal the statement line amount' : null

/** Lines no match holds, the bank has not removed and no undo has taken out of rules. */
const OPEN_LINES = `SELECT l.* FROM pt_bank_lines l WHERE l.removed_at IS NULL AND l.excluded_at IS NULL AND l.rules_off = 0
  AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines m WHERE m.bank_line_id = l.id AND m.active = 1)
  AND NOT EXISTS (SELECT 1 FROM pt_transfer_halves h WHERE h.bank_line_id = l.id AND h.status IN ('pending', 'exception'))`

/** Why a rule may not file this line now, or null. */
async function blocked(db: D1Database, line: Data) {
  const locked = await one(db, "SELECT id FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", line.posted_date)
  if (locked) return `${locked.id} is locked`
  const rec = await one(db, 'SELECT s.end_date FROM pt_reconciliations r JOIN pt_statements s ON s.id = r.statement_id WHERE r.bank_account_id = ? AND ? BETWEEN s.start_date AND s.end_date', line.bank_account_id, line.posted_date)
  return rec ? `inside a reconciled statement (ending ${rec.end_date})` : null
}

const notReconciled = (line: Data) => guard('NOT EXISTS (SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id = r.statement_id WHERE r.bank_account_id = ? AND ? BETWEEN s.start_date AND s.end_date)', line.bank_account_id, line.posted_date)

/** The batch that files one line by a rule: a posted bank entry and a match naming the rule. */
export async function fileStatements(db: D1Database, rule: Rule, line: Data, filer: Filer): Promise<Sql[]> {
  requireThat(rule.mode !== 'suggest', 'Suggest-only rules never post entries', 409)
  requireThat(!splitHold(rule, line), 'Split amounts must equal the statement line amount', 409)
  const bank = (await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', line.bank_account_id))!
  const abs = Math.abs(line.amount_cents), out = line.amount_cents < 0
  const code = rule.tax_code_id ? await one(db, 'SELECT * FROM pt_tax_codes WHERE id = ?', rule.tax_code_id) : null
  const tax = code ? scale(abs, code.rate_milli_percent, 100000 + code.rate_milli_percent) : 0
  const net = abs - tax
  const parts = rule.splits.map((s, i) => ({ accountId: s.accountId, amount: i < rule.splits.length - 1 ? rule.split_mode === 'amount' ? scale(net, s.amountCents!, abs) : scale(net, s.share!, 10000) : 0 }))
  parts[parts.length - 1].amount = net - parts.slice(0, -1).reduce((n, p) => n + p.amount, 0)
  if (code && tax) parts.push({ accountId: code.account_id, amount: tax })
  const memo = rule.memo || line.description
  const tags={...dimensionTags(line),...(typeof rule.dimension_actions==='string'?JSON.parse(rule.dimension_actions):rule.dimension_actions??{})}
  const lines = [
    ...parts.filter(p => p.amount > 0).map(p => ({ ...tags,accountId: p.accountId, debit: out ? p.amount : 0, credit: out ? 0 : p.amount, memo, contactId: rule.contact_id ?? null })),
    { accountId: bank.account_id, debit: out ? 0 : abs, credit: out ? abs : 0, memo },
  ]
  const entryId = uid(), matchId = uid()
  return [filer.authority, standingFence(standingAuthority(filer.actor.email, 'bank', [bank.id])), periodOpen(line.posted_date), notReconciled(line),
    guard('EXISTS(SELECT 1 FROM pt_bank_lines WHERE id=? AND excluded_at IS NULL)',line.id),
    guard('NOT EXISTS (SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1)', line.id),
    guard("NOT EXISTS (SELECT 1 FROM pt_transfer_halves WHERE bank_line_id = ? AND status IN ('pending', 'exception'))", line.id),
    guard('EXISTS (SELECT 1 FROM pt_bank_rules WHERE id = ? AND revision = ? AND active = 1)', rule.id, rule.revision),
    ...entryStatements({ id: entryId, date: line.posted_date, memo: `${memo} · by rule ${rule.name}`, sourceKind: 'bank', sourceId: line.id, preparedBy: filer.actor.email, preparedKind: 'person', lines }, filer.actor.email),
    q("INSERT INTO pt_matches (id, bank_account_id, status, proposal_id, note, approved_by, approved_at, revision, rule_id, rule_revision, rule_snapshot) VALUES (?, ?, 'approved', NULL, ?, ?, ?, ?, ?, ?, ?)", matchId, bank.id, `Filed by rule "${rule.name}"`, filer.actor.email, now(), uid(), rule.id, rule.revision, JSON.stringify(rule)),
    q('INSERT INTO pt_match_bank_lines (match_id, bank_line_id, active) VALUES (?, ?, 1)', matchId, line.id),
    q('INSERT INTO pt_match_postings (match_id, journal_line_id, active) SELECT ?, id, 1 FROM pt_journal_lines WHERE entry_id = ? AND account_id = ?', matchId, entryId, bank.account_id),
    audit(filer.actor, 'bank-rule.file', 'match', matchId, { rule: rule.name, ruleId: rule.id, line: line.id, amount: line.amount_cents, description: line.description }),
  ]
}

/** File each line by the first active rule it matches; a line a rule may not touch is left for a person. */
export async function applyRules(db: D1Database, lineIds: string[], filer: (rule: Rule) => Filer) {
  const result = { filed: 0, skipped: 0 }
  if (!lineIds.length) return result
  const active = await rules(db)
  if (!active.length) return result
  for (let i = 0; i < lineIds.length; i += 100) {
    const chunk = lineIds.slice(i, i + 100)
    const lines = await all(db, `${OPEN_LINES} AND l.id IN (${chunk.map(() => '?').join(',')}) ORDER BY l.posted_date, l.id`, ...chunk)
    const depositSuggestions = await depositProposals(db, lines), recorded = await recordedPaymentCandidates(db, lines)
    for (const line of lines) {
      if (depositSuggestions[line.id] || recorded[line.id]?.length) continue
      const rule = active.find(r => ruleMatches(r, line))
      if (!rule) continue
      if (rule.mode === 'suggest' || splitHold(rule, line) || await blocked(db, line)) { result.skipped++; continue }
      try { await run(db, await fileStatements(db, rule, line, filer(rule))); result.filed++ }
      catch (e) { if (e instanceof Fault && e.status === 409) result.skipped++; else throw e }
    }
  }
  return result
}

/** A rule's author still holding the record capability, for filing with no one signed in. */
export const authorFiler = (rule: Rule): Filer => ({
  actor: { email: rule.created_by, kind: 'person' },
  authority: standingFence(standingAuthority(rule.created_by, 'bank', rule.bank_account_id ? [rule.bank_account_id] : [])),
})
const personFiler = (c: Context) => (): Filer => ({ actor: who(c.actor), authority: authority(c.actor, 'record') })

/** Open matches, and the six latest matching charges including already-filed history. */
async function preview(db: D1Database, rule: Rule, others: Rule[]) {
  const candidates = (await all(db, `${OPEN_LINES} ORDER BY l.posted_date DESC, l.id`)).filter(l => ruleMatches(rule, l))
  const earlier = (await all(db, 'SELECT l.* FROM pt_bank_lines l WHERE l.removed_at IS NULL AND l.excluded_at IS NULL ORDER BY l.posted_date DESC, l.id')).filter(l => ruleMatches(rule, l)).slice(0, 6)
  const files: Data[] = [], held: Data[] = [], preceded: Data[] = [], suggested: Data[] = []
  const deposits = await depositProposals(db, candidates), recorded = await recordedPaymentCandidates(db, candidates)
  for (const l of candidates) {
    const first = others.find(r => precedes(r, rule) < 0 && ruleMatches(r, l))
    if (first) { preceded.push({ ...l, reason: `rule ${first.name} takes precedence` }); continue }
    const why = deposits[l.id] ? 'Review the proposed invoice payment first' : recorded[l.id]?.length ? 'Match the recorded payment first' : await blocked(db, l) || splitHold(rule, l) || await dimensionRefusal(db,rule.splits.map(s=>s.accountId),{...dimensionTags(l),...(typeof rule.dimension_actions==='string'?JSON.parse(rule.dimension_actions):rule.dimension_actions??{})})
    if (why) held.push({ ...l, reason: why })
    else if (rule.mode === 'suggest') suggested.push({ ...l, reason: 'Suggest only; a person must file this line' })
    else files.push(l)
  }
  return { files, held, earlier, preceded, suggested, total: files.reduce((n, l) => n + l.amount_cents, 0) }
}

const previewRule: Command = { need: 'record', async run(c, b) {
  const input = await ruleInput(c.db, b), active = await rules(c.db)
  const current = b.id ? active.find(r => r.id === b.id) : null
  const p = await preview(c.db, asRow(input, { id: current?.id ?? '~', priority: input.priority ?? current?.priority ?? (Math.max(0, ...active.map(r => r.priority)) + 1), created_at: current?.created_at ?? now() }), active.filter(r => r.id !== b.id))
  return { ...p, files: p.files.slice(0, 200), held: p.held.slice(0, 50), preceded: p.preceded.slice(0, 50), suggested: p.suggested.slice(0, 200), count: p.files.length }
} }

const ruleFields = (input: Awaited<ReturnType<typeof ruleInput>>) => [input.name, input.bankAccountId, input.direction, input.payee, input.descriptionContains, input.amountMin, input.amountMax, JSON.stringify(input.splits), input.contactId, input.taxCodeId, input.memo, input.mode, input.descriptionMode, input.splitMode,JSON.stringify(input.dimensionConditions),JSON.stringify(input.dimensionActions)]
const ruleInsert = (id: string, fields: unknown[], by: string, priority: number | null) =>
  q('INSERT INTO pt_bank_rules (id, name, bank_account_id, direction, payee, description_contains, amount_min_cents, amount_max_cents, splits, contact_id, tax_code_id, memo, mode, description_mode, split_mode,dimension_conditions,dimension_actions, position, priority, active, created_by, created_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM pt_bank_rules), COALESCE(?, (SELECT COALESCE(MAX(priority), 0) + 1 FROM pt_bank_rules)), 1, ?, ?, ?)', id, ...fields, priority, by, now(), uid())

/** A new rule from rule input (the same checks as a saved one), for a write the caller authorises. */
export async function newRuleStatements(db: D1Database, b: Data, by: AuditActor) {
  const input = await ruleInput(db, b), id = uid()
  return { id, statements: [...bankAuthority(by, input.bankAccountId ? [input.bankAccountId] : []), ruleInsert(id, ruleFields(input), by.email, input.priority), audit(by, 'bank-rule.create', 'bank-rule', id, { name: input.name })] }
}

const saveRule: Command = { need: 'record', async run(c, b) {
  const input = await ruleInput(c.db, b)
  const fields = ruleFields(input)
  let id: string
  if (b.id) {
    const current = await one(c.db, 'SELECT * FROM pt_bank_rules WHERE id = ?', text(b.id, 'Rule'))
    requireThat(current && current.active, 'Active rule not found', 404)
    requireThat(current.revision === b.revision, 'This rule changed since you opened it; reload', 409)
    id = current.id
    await run(c.db, [authority(c.actor, 'record'), ...bankAuthority(c.actor, input.bankAccountId ? [input.bankAccountId] : []),
      q('UPDATE pt_bank_rules SET name = ?, bank_account_id = ?, direction = ?, payee = ?, description_contains = ?, amount_min_cents = ?, amount_max_cents = ?, splits = ?, contact_id = ?, tax_code_id = ?, memo = ?, mode = ?, description_mode = ?, split_mode = ?,dimension_conditions=?,dimension_actions=?, priority = COALESCE(?, priority), revision = ? WHERE id = ? AND revision = ?', ...fields, input.priority, uid(), id, b.revision), changed(),
      audit(who(c.actor), 'bank-rule.edit', 'bank-rule', id, { name: input.name })])
  } else {
    id = uid()
    await run(c.db, [authority(c.actor, 'record'), ...bankAuthority(c.actor, input.bankAccountId ? [input.bankAccountId] : []), ruleInsert(id, fields, c.actor.email, input.priority), audit(who(c.actor), 'bank-rule.create', 'bank-rule', id, { name: input.name })])
  }
  // Filing what the preview showed is the person's choice, made with the save.
  let filed = { filed: 0, skipped: 0 }
  if (b.fileExisting === true) {
    const saved = (await rules(c.db)).find(r => r.id === id)!
    const p = await preview(c.db, saved, (await rules(c.db)).filter(r => r.id !== id))
    filed = await applyRules(c.db, p.files.map(l => l.id), personFiler(c))
  }
  return { rule: await one(c.db, 'SELECT * FROM pt_bank_rules WHERE id = ?', id), ...filed }
} }

const retireRule: Command = { need: 'record', async run(c, b) {
  const current = await one(c.db, 'SELECT * FROM pt_bank_rules WHERE id = ? AND active = 1', text(b.id, 'Rule'))
  requireThat(current, 'Rule not found', 404)
  await run(c.db, [authority(c.actor, 'record'), ...bankAuthority(c.actor, current.bank_account_id ? [current.bank_account_id] : []), q('UPDATE pt_bank_rules SET active = 0, revision = ? WHERE id = ? AND revision = ?', uid(), current.id, b.revision), changed(),
    audit(who(c.actor), 'bank-rule.retire', 'bank-rule', current.id, { name: current.name })])
  return { id: current.id }
} }

/** Undo a rule's filing: the match ends, its entry is reversed on the same day, and rules leave the line to a person. */
const undoFiling: Command = { need: 'record', async run(c, b) {
  const match = await one(c.db, 'SELECT * FROM pt_matches WHERE id = ?', text(b.matchId, 'Filing'))
  requireThat(match && match.status === 'approved' && match.rule_id, 'Filing by rule not found', 404)
  requireThat(!match.reconciliation_id, 'This line is part of a completed reconciliation', 409)
  const line = (await one(c.db, 'SELECT l.* FROM pt_match_bank_lines m JOIN pt_bank_lines l ON l.id = m.bank_line_id WHERE m.match_id = ?', match.id))!
  const created = await one(c.db, "SELECT DISTINCT e.id FROM pt_match_postings mp JOIN pt_journal_lines jl ON jl.id = mp.journal_line_id JOIN pt_journal_entries e ON e.id = jl.entry_id WHERE mp.match_id = ? AND e.source_kind = 'bank' AND e.reversed_by_id IS NULL", match.id)
  requireThat(created, 'The filed entry was already reversed', 409)
  const original = await entry(c.db, created.id)
  const reversal = await reversalStatements(c.db, c.actor, original, original.entry_date, `Undo filing by rule — ${line.description}`, { unmatching: true })
  await run(c.db, [authority(c.actor, 'record'), ...bankAuthority(c.actor, [match.bank_account_id]),
    q("UPDATE pt_matches SET status = 'undone', revision = ? WHERE id = ? AND status = 'approved' AND reconciliation_id IS NULL", uid(), match.id), changed(),
    q('UPDATE pt_match_bank_lines SET active = 0 WHERE match_id = ?', match.id), q('UPDATE pt_match_postings SET active = 0 WHERE match_id = ?', match.id),
    ...reversal.statements,
    q('UPDATE pt_bank_lines SET rules_off = 1 WHERE id = ?', line.id),
    audit(who(c.actor), 'bank-rule.undo', 'match', match.id, { ruleId: match.rule_id, line: line.id, reversal: reversal.id, reason: optionalText(b.reason, 'Reason', 300) })])
  return { id: match.id, reversal: reversal.id }
} }

export const ruleCommands: Record<string, Command> = {
  'bank-rule.preview': previewRule,
  'bank-rule.save': saveRule,
  'bank-rule.retire': retireRule,
  'bank-rule.undo': undoFiling,
}

/** Apply rules to lines a person just brought in (a statement import). */
export const applyRulesAs = (c: Context, lineIds: string[]) => applyRules(c.db, lineIds, personFiler(c))

/** A payee a person has filed the same way three or more times, with no rule yet. */
export async function suggestions(db: D1Database, active: Rule[]) {
  const rows = await all(db, `SELECT m.id AS match_id, l.id AS line_id, l.bank_account_id, l.payee, l.description, l.amount_cents, l.posted_date, jl.account_id, a.name AS account_name
    FROM pt_matches m JOIN pt_match_bank_lines mb ON mb.match_id = m.id AND mb.active = 1 JOIN pt_bank_lines l ON l.id = mb.bank_line_id
    JOIN pt_match_postings mp ON mp.match_id = m.id AND mp.active = 1 JOIN pt_journal_lines bl ON bl.id = mp.journal_line_id
    JOIN pt_journal_entries e ON e.id = bl.entry_id AND e.source_kind = 'bank' JOIN pt_journal_lines jl ON jl.entry_id = e.id AND jl.id <> bl.id JOIN pt_accounts a ON a.id = jl.account_id
    WHERE m.status = 'approved' AND m.rule_id IS NULL ORDER BY l.posted_date DESC`)
  const byMatch = new Map<string, Data[]>()
  for (const r of rows) byMatch.set(r.match_id, [...(byMatch.get(r.match_id) ?? []), r])
  const groups = new Map<string, Data>()
  for (const parts of byMatch.values()) {
    if (new Set(parts.map(p => p.line_id)).size !== 1 || parts.length !== 1) continue
    const p = parts[0], key = payeeKey(p), direction = p.amount_cents < 0 ? 'out' : 'in'
    if (!key) continue
    const k = `${key}|${p.account_id}|${direction}`
    const g = groups.get(k) ?? { payee: title(key), accountId: p.account_id, accountName: p.account_name, direction, count: 0, example: p }
    g.count++
    groups.set(k, g)
  }
  return [...groups.values()].filter(g => g.count >= 3 && !active.some(r => ruleMatches(r, g.example)))
    .map(({ example, ...g }) => ({ ...g, example: example.description, last: example.posted_date }))
}

export async function rulesView(db: D1Database) {
  const all_ = await rules(db, { active: true })
  const open = await all(db, `${OPEN_LINES} ORDER BY l.posted_date DESC, l.id`)
  const suggestedLines: Data[] = []
  const deposits = await depositProposals(db, open), recorded = await recordedPaymentCandidates(db, open)
  for (const line of open) {
    const rule = all_.find(r => ruleMatches(r, line))
    if (rule?.mode !== 'suggest') continue
    const reason = deposits[line.id] ? 'Review the proposed invoice payment first' : recorded[line.id]?.length ? 'Match the recorded payment first' : await blocked(db, line) || splitHold(rule, line) || 'Review and file this suggestion'
    suggestedLines.push({ ...line, ruleId: rule.id, ruleName: rule.name, ruleRevision: rule.revision, splits: rule.splits, splitMode: rule.split_mode, reason })
  }
  const counts = new Map((await all(db, "SELECT rule_id, COUNT(*) AS n, MAX(approved_at) AS last FROM pt_matches WHERE status = 'approved' AND rule_id IS NOT NULL GROUP BY rule_id")).map(r => [r.rule_id, r]))
  return {
    rules: all_.map(r => ({ ...r, filed: Number(counts.get(r.id)?.n ?? 0), lastFiled: counts.get(r.id)?.last ?? null })),
    suggestions: await suggestions(db, all_),
    suggestedLines,
    filings: (await all(db, `SELECT m.id, m.rule_id, m.rule_revision, m.rule_snapshot, m.status, mb.bank_line_id FROM pt_matches m JOIN pt_match_bank_lines mb ON mb.match_id = m.id WHERE m.rule_id IS NOT NULL ORDER BY m.approved_at DESC, m.id LIMIT 300`)).map(m => ({ ...m, rule_snapshot: JSON.parse(m.rule_snapshot) })),
  }
}
