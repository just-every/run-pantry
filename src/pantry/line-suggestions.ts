// Read-only filing advice. A person's most recent filing wins over older
// patterns and defaults; only match.approve records a decision, never this read.
import { now, type Data } from './core'
import { all, audit, q, type AuditActor, type Sql } from './db'
import { payeeKey, ruleMatches, rules } from './rules'
import { candidates, matchFacts } from './receipts/matches'
import { vendorNameKey } from './receipts/vendor-match'

export type SuggestionSource = 'history' | 'vendor' | 'document'
export type LineSuggestion = {
  billId?: string; accountId: string; accountName: string; payee: string; contactId: string | null
  source: SuggestionSource; sourceId: string; reason: string
  confidence: number; confidenceReason: string; evidenceCount: number
}
export type SuggestionRate = {
  source: SuggestionSource; accepted: number; changed: number; total: number
  acceptanceRate: number | null; changeRate: number | null
}
const SOURCES: SuggestionSource[] = ['history', 'vendor', 'document']
const direction = (l: Data) => l.amount_cents < 0 ? 'expense' : 'income'
const key = (l: Data) => `${direction(l)}:${payeeKey(l)}`
const placeholders = (ids: unknown[]) => ids.map(() => '?').join(',')

/** Only an explicit name/confirmed alias identifies a default; ambiguity abstains. */
function vendorFor(line: Data, vendors: Data[], aliases: Data[]) {
  const name = vendorNameKey(line.payee || line.description)
  if (!name) return null
  const matches = vendors.filter(v => vendorNameKey(v.name) === name || aliases.some(a => a.vendor_id === v.id && a.alias_key === name))
  return matches.length === 1 ? matches[0] : null
}

/** Public queue read. Re-read persisted lines so stale caller fields cannot advise on filed lines. */
export async function lineSuggestions(db: D1Database, lines: Data[]): Promise<Record<string, LineSuggestion>> {
  const ids = [...new Set(lines.filter(l => !l.pending).map(l => String(l.id)))]
  if (!ids.length) return {}
  const [active, accounts, vendors, aliases, history] = await Promise.all([
    rules(db),
    all(db, "SELECT id, name, type FROM pt_accounts WHERE active = 1 AND type IN ('expense', 'income')"),
    all(db, "SELECT id, name, default_account_id FROM pt_contacts WHERE active = 1 AND kind = 'vendor'"),
    all(db, 'SELECT vendor_id, alias_key FROM pt_vendor_aliases'),
    // Group below by filing, not posting: one split never becomes a made-up
    // single category, and each manual bank line contributes at most once.
    all(db, `SELECT l.id, l.payee, l.description, l.amount_cents, m.id AS match_id,
        j.account_id, c.id AS contact_id, c.name AS contact_name
      FROM pt_match_bank_lines mb JOIN pt_bank_lines l ON l.id = mb.bank_line_id
      JOIN pt_matches m ON m.id = mb.match_id
      JOIN pt_match_postings mp ON mp.match_id = m.id AND mp.active = 1
      JOIN pt_journal_lines bank ON bank.id = mp.journal_line_id
      JOIN pt_journal_entries e ON e.id = bank.entry_id
      JOIN pt_journal_lines j ON j.entry_id = e.id AND j.id <> bank.id
      JOIN pt_accounts a ON a.id = j.account_id
      LEFT JOIN pt_contacts c ON c.id = j.contact_id AND c.active = 1
      WHERE mb.active = 1 AND m.status = 'approved' AND m.rule_id IS NULL AND m.automatic = 0
        AND e.status = 'posted' AND e.reversed_by_id IS NULL AND e.prepared_kind = 'person'
        AND a.type IN ('expense', 'income')
        AND EXISTS (SELECT 1 FROM pt_audit au WHERE au.subject_kind = 'match'
          AND au.subject_id = m.id AND au.action = 'match.approve' AND au.actor_kind = 'person')
      ORDER BY m.approved_at DESC, m.rowid DESC, l.id, j.line_no`),
  ])
  const accountById = new Map(accounts.map(a => [a.id, a]))
  const filings = new Map<string, Data[]>()
  for (const h of history) {
    const id = `${h.match_id}:${h.id}`
    filings.set(id, [...(filings.get(id) ?? []), h])
  }
  const byPayee = new Map<string, Data[]>()
  for (const rows of filings.values()) {
    const h = rows[0]
    if (!payeeKey(h)) continue
    // Keep an ambiguous latest filing as a barrier to using older history.
    const unambiguous = new Set(rows.map(r => r.account_id)).size === 1
    const contacts = [...new Set(rows.map(r => r.contact_id).filter(Boolean))]
    const record = { ...h, account_id: unambiguous ? h.account_id : null,
      contact_id: contacts.length === 1 ? contacts[0] : null,
      contact_name: contacts.length === 1 ? rows.find(r => r.contact_id === contacts[0])?.contact_name : null }
    byPayee.set(key(h), [...(byPayee.get(key(h)) ?? []), record])
  }
  const result: Record<string, LineSuggestion> = {}
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    const [open, documents] = await Promise.all([
      all(db, `SELECT l.* FROM pt_bank_lines l WHERE l.id IN (${placeholders(chunk)}) AND l.removed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines mb WHERE mb.bank_line_id = l.id AND mb.active = 1)
        AND NOT EXISTS (SELECT 1 FROM pt_transfer_halves h WHERE h.bank_line_id = l.id AND h.status IN ('pending', 'exception'))`, ...chunk),
      all(db, `SELECT r.*, d.name, b.id AS bill_id, b.vendor_id AS bill_vendor_id FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id
        LEFT JOIN pt_bills b ON r.linked_kind = 'bill' AND r.linked_id = b.id AND b.status NOT IN ('draft', 'void')
        WHERE (r.status = 'review' OR (r.status = 'attached' AND b.id IS NOT NULL)) AND r.read_status = 'read' AND r.read_account_id IS NOT NULL
          AND r.duplicate_of IS NULL AND r.duplicate_document_id IS NULL
        ORDER BY r.read_at DESC, r.rowid DESC`),
    ])
    const linkedReadings: Data[] = []
    for (const doc of documents) for (const candidate of await candidates(db, doc.read_total_cents, doc.read_date, doc.read_vendor, doc.read_currency, matchFacts(doc))) {
      if (candidate.kind === 'bankline' && open.some(l => l.id === candidate.id)) linkedReadings.push({ ...doc, line_id: candidate.id })
    }
    for (const line of open) {
      // A covering rule owns the line in either mode, including a held rule.
      if (active.some(r => ruleMatches(r, line))) continue
      const attached = linkedReadings.filter(d => d.line_id === line.id)
      const billDoc = attached.find(d => d.bill_id)
      const prior = byPayee.get(key(line)) ?? [], latest = prior[0]
      const valid = (id: string | null) => { const a = accountById.get(id); return a?.type === direction(line) ? a : null }
      const lastAccount = latest && valid(latest.account_id)
      if (lastAccount && !billDoc) {
        let streak = 0
        for (const h of prior) { if (h.account_id !== latest.account_id) break; streak++ }
        const payee = latest.contact_name || latest.payee || payeeKey(line)
        result[line.id] = { accountId: lastAccount.id, accountName: lastAccount.name, payee,
          contactId: latest.contact_id, source: 'history', sourceId: latest.match_id, evidenceCount: streak,
          reason: streak === 1 ? `Your most recent manual filing for ${payee} went to ${lastAccount.name}.` : `Your last ${streak} manual filings for ${payee} went to ${lastAccount.name}.`,
          confidence: Math.round(100 * (streak + 1) / (streak + 2)),
          confidenceReason: `Evidence score: round(100 × (${streak} consecutive filings + 1) / (${streak} + 2)); not a calibrated probability.` }
        continue
      }
      const doc = billDoc ?? attached[0], docAccount = doc && valid(doc.read_account_id)
      // Conflicting attached readings remain for a person to resolve.
      if (docAccount && new Set(attached.map(d => d.read_account_id)).size === 1) {
        const contact = vendors.find(v => v.id === (doc.bill_vendor_id ?? doc.vendor_id))
        result[line.id] = { accountId: docAccount.id, accountName: docAccount.name,
          payee: contact?.name || doc.read_vendor || line.payee || payeeKey(line), contactId: contact?.id ?? null,
          billId: doc.bill_id ?? undefined, source: 'document', sourceId: doc.id, evidenceCount: attached.length,
          reason: `${doc.bill_id ? 'Attached bill document' : 'Matching receipt'} ${doc.name} was read as ${docAccount.name}.${doc.bill_id ? ' Match its vendor payment; do not create another expense.' : ''}`, confidence: 75,
          confidenceReason: 'Evidence score: 75% for a linked document reading; not a calibrated probability.' }
        continue
      }
      const vendor = vendorFor(line, vendors, aliases), defaultAccount = vendor && valid(vendor.default_account_id)
      if (defaultAccount) result[line.id] = { accountId: defaultAccount.id, accountName: defaultAccount.name,
        payee: vendor.name, contactId: vendor.id, source: 'vendor', sourceId: vendor.id, evidenceCount: 1,
        reason: `${vendor.name}'s saved vendor default is ${defaultAccount.name}.`, confidence: 80,
        confidenceReason: 'Evidence score: 80% for an exact vendor name or confirmed alias and its saved default; not a calibrated probability.' }
    }
  }
  return result
}

/** Append to the human match.approve batch, before it runs. IDs are the actual
 * expense/income categories chosen, either shared by the match or per line.
 * No suggestion, no decision. A split counts as changed unless it has only
 * the suggested category. Existing first decisions survive undo/re-filing. */
export async function suggestionDecisions(db: D1Database, lines: Data[], selectedAccountIds: string[] | Record<string, string[]>, actor: AuditActor, selectedContactIds: string[] = []): Promise<Sql[]> {
  if (actor.kind !== 'person' || !lines.length) return []
  const suggestions = await lineSuggestions(db, lines)
  const seen = new Set<string>()
  const statements: Sql[] = []
  const ids = Object.keys(suggestions)
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    for (const r of await all(db, `SELECT bank_line_id FROM pt_line_suggestion_decisions WHERE bank_line_id IN (${placeholders(chunk)})`, ...chunk)) seen.add(r.bank_line_id)
  }
  for (const [lineId, suggestion] of Object.entries(suggestions)) {
    if (seen.has(lineId)) continue
    const selected = [...new Set(Array.isArray(selectedAccountIds) ? selectedAccountIds : selectedAccountIds[lineId] ?? [])].sort()
    const contacts = [...new Set(selectedContactIds)]
    const payeeAgrees = !suggestion.contactId || (contacts.length === 1 && contacts[0] === suggestion.contactId)
    const outcome = selected.length === 1 && selected[0] === suggestion.accountId && payeeAgrees ? 'accepted' : 'changed'
    const event = audit(actor, 'suggestion.decision', 'bank-line', lineId, { suggestion, selectedAccountIds: selected, outcome })
    statements.push(q(`INSERT INTO pt_line_suggestion_decisions
      (bank_line_id, source, source_id, suggested_account_id, selected_account_ids, outcome, suggestion, actor_email, decided_at, audit_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, lineId, suggestion.source, suggestion.sourceId, suggestion.accountId,
      JSON.stringify(selected), outcome, JSON.stringify(suggestion), actor.email, now(), event.auditEvent!.id), event)
  }
  return statements
}

/** Percentages are null until a source has an actual human decision. */
export async function suggestionStats(db: D1Database): Promise<SuggestionRate[]> {
  const counts = await all(db, `SELECT source, SUM(outcome = 'accepted') AS accepted, SUM(outcome = 'changed') AS changed
    FROM pt_line_suggestion_decisions GROUP BY source`)
  return SOURCES.map(source => {
    const count = counts.find(c => c.source === source), accepted = Number(count?.accepted ?? 0), changed = Number(count?.changed ?? 0), total = accepted + changed
    return { source, accepted, changed, total, acceptanceRate: total ? Math.round(100 * accepted / total) : null, changeRate: total ? Math.round(100 * changed / total) : null }
  })
}
