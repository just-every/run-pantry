// Import-kit target adapter: each imported entity is one native Pantry row (the
// cutover is its record, its draft opening entry and that entry's lines). The
// snapshot predicate compares every native column, so any edit after import,
// such as posting the opening entry at sign-off, is a conflict the kit refuses
// to undo.
import type { D1Sql, D1TargetAdapter, TargetRow } from '../../modules/import-kit/src/d1/index'

const sql = (s: string, ...params: unknown[]): D1Sql => ({ sql: s, params })
type Database = Parameters<D1TargetAdapter['read']>[0]

type Kind = { table: string; columns: string[] }
const KINDS: Record<string, Kind> = {
  // Kind names avoid the kit's login-access words: these are ledger accounts and trading parties.
  chart: { table: 'pt_accounts', columns: ['code', 'name', 'type', 'subtype', 'description', 'active'] },
  counterparty: { table: 'pt_contacts', columns: ['kind', 'name', 'email', 'terms_days', 'external_ref', 'active'] },
  bank: { table: 'pt_bank_accounts', columns: ['name', 'account_id', 'institution', 'number_last4', 'routing', 'opening_date', 'opening_cents'] },
  invoice: { table: 'pt_invoices', columns: ['kind', 'number', 'customer_id', 'issue_date', 'due_date', 'status', 'memo', 'credit_for', 'subtotal_cents', 'tax_cents', 'total_cents', 'opening', 'journal_id', 'prepared_by', 'approved_by', 'approved_revision', 'issued_by', 'created_at'] },
  bill: { table: 'pt_bills', columns: ['vendor_id', 'reference', 'bill_date', 'due_date', 'status', 'memo', 'total_cents', 'opening', 'evidence_waived', 'journal_id', 'prepared_by', 'created_at'] },
  history: { table: 'pt_history_lines', columns: ['cutover_id', 'account', 'txn_date', 'txn_type', 'num', 'name', 'memo', 'split', 'amount_cents', 'source_row'] },
}
const CUTOVER = ['source', 'cutover_date', 'opening_entry_id', 'summary', 'status', 'accepted_by', 'accepted_at']
const ENTRY = ['id', 'number', 'entry_date', 'memo', 'source_kind', 'source_id', 'status', 'prepared_by', 'prepared_kind', 'proposal_id', 'document_id', 'posted_by', 'posted_at', 'reverses_id', 'reversed_by_id', 'created_at']
const LINE = ['line_no', 'account_id', 'debit_cents', 'credit_cents', 'memo', 'contact_id']

const pick = (row: Record<string, unknown>, columns: string[]) => Object.fromEntries(columns.map(c => [c, row[c] ?? null]))
const same = (columns: string[], value: Record<string, unknown>) => ({ where: columns.map(c => `${c} IS ?`).join(' AND '), params: columns.map(c => value[c] ?? null) })

async function readCutover(db: Database, destination: string, id: string): Promise<TargetRow | undefined> {
  const c = await db.prepare('SELECT * FROM pt_cutovers WHERE id = ?').bind(id).first<Record<string, unknown>>()
  if (!c) return undefined
  const e = (await db.prepare('SELECT * FROM pt_journal_entries WHERE id = ?').bind(c.opening_entry_id).first<Record<string, unknown>>())!
  const lines = (await db.prepare('SELECT * FROM pt_journal_lines WHERE entry_id = ? ORDER BY line_no').bind(e.id).all<Record<string, unknown>>()).results
  return { destination, targetKind: 'cutover', targetId: id, revision: String(c.revision), value: { cutover: pick(c, CUTOVER), entry: pick(e, ENTRY), lines: lines.map(l => pick(l, LINE)) } as any }
}

/** The cutover snapshot as separate predicates (D1 binds at most 100 values per statement). */
function cutoverParts(row: TargetRow | null, id: string): D1Sql[] {
  if (!row) return [sql("NOT EXISTS (SELECT 1 FROM pt_cutovers WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM pt_journal_entries WHERE id = ? || '-entry')", id, id)]
  const v = row.value as any, c = same(CUTOVER, v.cutover), e = same(ENTRY, v.entry)
  return [
    sql(`EXISTS (SELECT 1 FROM pt_cutovers WHERE id = ? AND revision = ? AND ${c.where})`, id, row.revision, ...c.params),
    sql(`EXISTS (SELECT 1 FROM pt_journal_entries WHERE ${e.where})`, ...e.params),
    sql('(SELECT COUNT(*) FROM pt_journal_lines WHERE entry_id = ?) = ?', v.entry.id, v.lines.length),
    ...v.lines.map((l: any) => { const m = same(LINE, l); return sql(`EXISTS (SELECT 1 FROM pt_journal_lines WHERE entry_id = ? AND ${m.where})`, v.entry.id, ...m.params) }),
  ]
}
const conjunction = (parts: D1Sql[]): D1Sql => ({ sql: parts.map(p => `(${p.sql})`).join(' AND '), params: parts.flatMap(p => p.params ?? []) })

/** The adapter for one source's rows: every id it writes starts with the source's prefix. */
export function targetsFor(prefix: string): D1TargetAdapter {
  const IMPORTED = `id LIKE '${prefix}-%'`
  return {
    async read(db, destination, kind, id) {
      if (kind === 'cutover') return readCutover(db, destination, id)
      const k = KINDS[kind]
      const r = await db.prepare(`SELECT * FROM ${k.table} WHERE id = ?`).bind(id).first<Record<string, unknown>>()
      return r ? { destination, targetKind: kind, targetId: id, revision: String(r.revision), value: pick(r, k.columns) as any } : undefined
    },
    matches(row, _destination, kind, id) {
      if (kind === 'cutover') return conjunction(cutoverParts(row, id))
      const k = KINDS[kind]
      if (!row) return sql(`NOT EXISTS (SELECT 1 FROM ${k.table} WHERE id = ?)`, id)
      const m = same(k.columns, row.value as any)
      return sql(`EXISTS (SELECT 1 FROM ${k.table} WHERE id = ? AND revision = ? AND ${m.where})`, id, row.revision, ...m.params)
    },
    matchesParts(row, destination, kind, id) {
      return kind === 'cutover' ? cutoverParts(row, id) : [this.matches(row, destination, kind, id)]
    },
    write(row) {
      const v = row.value as any
      if (row.targetKind === 'cutover') {
        return [
          sql(`INSERT INTO pt_journal_entries (${ENTRY.join(', ')}, revision) VALUES (${ENTRY.map(() => '?').join(', ')}, ?)`, ...ENTRY.map(c => v.entry[c] ?? null), row.revision),
          ...v.lines.map((l: any) => sql(`INSERT INTO pt_journal_lines (id, entry_id, ${LINE.join(', ')}) VALUES (?, ?, ${LINE.map(() => '?').join(', ')})`, `${v.entry.id}-${l.line_no}`, v.entry.id, ...LINE.map(c => l[c] ?? null))),
          sql(`INSERT INTO pt_cutovers (id, ${CUTOVER.join(', ')}, revision) VALUES (?, ${CUTOVER.map(() => '?').join(', ')}, ?)`, row.targetId, ...CUTOVER.map(c => v.cutover[c] ?? null), row.revision),
        ]
      }
      const k = KINDS[row.targetKind]
      return [sql(`INSERT INTO ${k.table} (id, ${k.columns.join(', ')}, revision) VALUES (?, ${k.columns.map(() => '?').join(', ')}, ?) ON CONFLICT(id) DO UPDATE SET ${k.columns.map(c => `${c} = excluded.${c}`).join(', ')}, revision = excluded.revision`, row.targetId, ...k.columns.map(c => v[c] ?? null), row.revision)]
    },
    remove(_destination, kind, id) {
      if (kind === 'cutover') return [
        sql('DELETE FROM pt_cutovers WHERE id = ?', id),
        sql("DELETE FROM pt_journal_lines WHERE entry_id = ? || '-entry'", id),
        sql("DELETE FROM pt_journal_entries WHERE id = ? || '-entry'", id),
      ]
      return [sql(`DELETE FROM ${KINDS[kind].table} WHERE id = ?`, id)]
    },
    async list(db, destination) {
      const rows: TargetRow[] = []
      for (const [kind, k] of Object.entries(KINDS)) {
        const found = (await db.prepare(`SELECT * FROM ${k.table} WHERE ${IMPORTED}`).all<Record<string, unknown>>()).results
        rows.push(...found.map(r => ({ destination, targetKind: kind, targetId: String(r.id), revision: String(r.revision), value: pick(r, k.columns) as any })))
      }
      for (const c of (await db.prepare(`SELECT id FROM pt_cutovers WHERE ${IMPORTED}`).all<{ id: string }>()).results) rows.push((await readCutover(db, destination, c.id))!)
      return rows
    },
    matchesCount(count) {
      return sql(`(${[...Object.values(KINDS).map(k => `(SELECT COUNT(*) FROM ${k.table} WHERE ${IMPORTED})`), `(SELECT COUNT(*) FROM pt_cutovers WHERE ${IMPORTED})`].join(' + ')}) = ?`, count)
    },
  }
}
