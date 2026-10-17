// Money a provider moved, matched to the bank line that shows it. A booked
// Stripe payout waits for its deposit; a booked Gusto payroll waits for its
// debits (one combined debit, or one per kind: net pay, taxes, ...). When
// exactly one set of unmatched bank lines in the date window fits, Pantry
// matches it, marked "matched automatically" with an undo; otherwise it waits.
// After an undo the entry is left for a person.
import { pantry } from './access'
import { addDays, Fault, type Data } from './core'
import { all, one, run } from './db'
import { matchPlan } from './matching'

export type Expectation = { entryId: string; bankAccountId: string; day: string; before: number; after: number; hint: RegExp; note: string }

/** Match one booked entry's bank postings, if one set of bank lines fits. Returns the match id, or null. */
export async function matchEntry(db: D1Database, x: Expectation): Promise<string | null> {
  const bank = await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', x.bankAccountId)
  if (!bank) return null
  const postings = await all(db, `SELECT l.id, l.debit_cents - l.credit_cents AS signed, l.memo FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
    WHERE l.entry_id = ? AND l.account_id = ? AND e.status = 'posted' AND e.reversed_by_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM pt_match_postings m WHERE m.journal_line_id = l.id) ORDER BY l.line_no`, x.entryId, bank.account_id)
  // A posting once matched (and perhaps undone by a person) is the person's to match now.
  if (!postings.length) return null
  const lines = await all(db, `SELECT id, amount_cents, description, payee, reference, posted_date FROM pt_bank_lines
    WHERE bank_account_id = ? AND removed_at IS NULL AND posted_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines m WHERE m.bank_line_id = pt_bank_lines.id AND m.active = 1) ORDER BY posted_date, id`,
    bank.id, addDays(x.day, -x.before), addDays(x.day, x.after))
  const named = (l: Data) => x.hint.test(`${l.description} ${l.payee ?? ''} ${l.reference}`)
  // Prefer lines that name the provider; fall back to amount alone.
  const pick = (want: number, taken: Set<string>) => {
    const fits = lines.filter(l => l.amount_cents === want && !taken.has(l.id))
    const byName = fits.filter(named)
    return byName.length === 1 ? byName[0] : !byName.length && fits.length === 1 ? fits[0] : null
  }
  // Postings group by the movement they describe (the memo before " · ").
  const groups = new Map<string, Data[]>()
  for (const p of postings) groups.set(String(p.memo).split(' · ')[0], [...(groups.get(String(p.memo).split(' · ')[0]) ?? []), p])
  const total = postings.reduce((s, p) => s + p.signed, 0)
  let chosen: Data[] | null = null
  const single = pick(total, new Set())
  if (single) chosen = [single]
  else if (groups.size > 1) {
    const taken = new Set<string>(), each: Data[] = []
    for (const g of groups.values()) {
      const l = pick(g.reduce((s, p) => s + p.signed, 0), taken)
      if (!l) break
      taken.add(l.id); each.push(l)
    }
    if (each.length === groups.size) chosen = each
  }
  if (!chosen) return null
  try {
    const plan = await matchPlan(db, pantry('auto-match'), { bankLineIds: chosen.map(l => l.id), journalLineIds: postings.map(p => p.id), create: [], note: x.note }, { automatic: true })
    await run(db, plan.statements)
    return plan.id
  } catch (error) {
    if (error instanceof Fault) return null
    throw error
  }
}

/** The match holding an entry's bank posting, with the bank line(s) it cleared. */
export async function entryMatch(db: D1Database, entryId: string | null) {
  if (!entryId) return null
  const m = await one(db, `SELECT DISTINCT m.id, m.automatic FROM pt_match_postings mp JOIN pt_matches m ON m.id = mp.match_id JOIN pt_journal_lines l ON l.id = mp.journal_line_id
    WHERE l.entry_id = ? AND mp.active = 1 AND m.status = 'approved' LIMIT 1`, entryId)
  if (!m) return null
  const lines = await all(db, 'SELECT b.posted_date, b.amount_cents, b.description FROM pt_match_bank_lines mb JOIN pt_bank_lines b ON b.id = mb.bank_line_id WHERE mb.match_id = ? AND mb.active = 1 ORDER BY b.posted_date', m.id)
  return { id: m.id, automatic: !!m.automatic, lines }
}
