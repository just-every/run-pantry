// Scheduled and request-driven due work reads a flat handful of rows however long the books are.
// A month of history (about a thousand journal lines and as many bank lines) sits in D1; the
// half-hourly Cron tick and an ordinary request's due work run with the ledger unchanged since the
// day's checks, and each is held to a ceiling a scan of that history would exceed several times over
// (before the work was gated on a change, one tick read about 5,700 rows here and grew with every line).
import test from 'node:test'
import assert from 'node:assert/strict'
import { books, harness } from './harness.mjs'

test('due work on an unchanged ledger reads flat rows, not the books', async t => {
  const h = await harness({ entry: 'tests/api/read-budget-worker.ts' }); t.after(() => h.close())
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0.00' })
  const entries = 330, statements = []
  for (let i = 0; i < entries; i++) {
    const id = `budget-journal-${i}`, date = new Date(Date.now() - (i % 30) * 86400000).toISOString().slice(0, 10), cents = 10000 + i
    statements.push(h.db.prepare("INSERT INTO pt_journal_entries(id,entry_date,memo,source_kind,status,prepared_by,prepared_kind,revision,created_at) VALUES(?,?,'budget history','manual','draft','owner@example.test','person','budget',?)").bind(id, date, date + 'T10:00:00Z'))
    const lines = [[acct['1000'], cents, 0], [acct['4000'], 0, cents / 2], [acct['2100'] ?? acct['4000'], 0, cents / 2]]
    lines.forEach(([account, debit, credit], k) => statements.push(h.db.prepare('INSERT INTO pt_journal_lines(id,entry_id,line_no,account_id,debit_cents,credit_cents,memo) VALUES(?,?,?,?,?,?,?)').bind(`${id}-${k}`, id, k + 1, account, debit, credit, '')))
    statements.push(h.db.prepare("UPDATE pt_journal_entries SET status='posted',posted_by='owner@example.test',posted_at=? WHERE id=?").bind(date + 'T10:00:00Z', id))
    statements.push(h.db.prepare("INSERT INTO pt_bank_lines(id,statement_id,bank_account_id,posted_date,amount_cents,description,fingerprint,source,arrived_at) VALUES(?,NULL,?,?,?,?,?,'feed',?)").bind(`budget-bank-${i}`, bank.id, date, (i % 2 ? 1 : -1) * (2000 + i), `CARD PURCHASE ${i}`, `budget-${i}`, date + 'T09:00:00Z'))
  }
  for (let i = 0; i < statements.length; i += 100) await h.db.batch(statements.slice(i, i + 100))
  const lines = (await h.db.prepare("SELECT COUNT(*) AS n FROM pt_journal_lines").first()).n
  assert.ok(lines >= 990, `a month of postings is in place (${lines} lines)`)

  const measure = async door => {
    const r = await h.send(`/__budget?door=${door}`, undefined, { cookie: h.owner })
    assert.equal(r.status, 200, JSON.stringify(r.value))
    assert.equal(r.value.unmetered, 0, 'every statement reports the rows it touched')
    return r.value
  }
  const first = await measure('cron')
  // What one job writes in that tick (a flag, a question) is a change to the others; the next tick looks once more and finds nothing.
  await measure('cron')
  t.diagnostic(`first tick: ${first.reads} rows read; heaviest ${JSON.stringify(first.heaviest)}`)
  assert.ok(first.reads > 1000, `the day's first tick does the checks over the books (${first.reads} rows)`)
  for (const door of ['cron', 'request', 'cron']) {
    const run = await measure(door)
    t.diagnostic(`${door}: ${run.reads} rows read, ${run.writes} written; heaviest ${JSON.stringify(run.heaviest)}`)
    assert.ok(run.reads <= 1500, `${door} with the ledger unchanged read ${run.reads} rows; a scan of ${lines} lines would be many times that`)
  }
})
