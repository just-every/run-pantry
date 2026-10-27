// A repeatable monthly agent command. It prepares work under existing human
// approval doors; it never grants standing authority, posts, sends or locks.
import { authority, who, type Agent } from './access'
import type { Command } from './context'
import { monthBounds, now, requireThat, text, usd, type Data } from './core'
import { all, audit, one, q, run } from './db'
import { openBalance } from './invoices'
import { refunded } from './refunds/store'
import { mechanicalActionRefs } from './month-close-actions'
import { closeState } from './close'
import { fileProposal, proposal, stillCurrent } from './proposals'
import { reconciliationState, reconciliationFingerprint } from './reconcile'
import { recognitionView } from './recognition'
import { recurringJournalsView } from './recurring-journals'

async function prepare(db: D1Database, actor: Agent, input: Data) {
  const existing = await all(db, "SELECT id FROM pt_proposals WHERE agent_id = ? AND kind = ? AND status IN ('proposed', 'approved') AND payload = ? ORDER BY created_at, id", actor.id, input.kind, JSON.stringify(input.payload))
  for (const row of existing) {
    const saved = await proposal(db, row.id)
    if (await stillCurrent(db, saved.refs)) return saved
  }
  // Changed work replaces this agent's pending version, rather than leaving a
  // month of obsolete packets for the accountant to dismiss individually.
  await run(db, [authority(actor, 'record'),
    q("UPDATE pt_proposals SET status = 'stale', revision = ? WHERE agent_id = ? AND kind = ? AND summary = ? AND status = 'proposed' AND json_extract(payload, '$.period') IS ?", crypto.randomUUID(), actor.id, input.kind, input.summary, input.payload.period ?? null),
    audit(who(actor), 'proposal.refresh', 'agent', actor.id, { kind: input.kind, period: input.payload.period ?? null, summary: input.summary })])
  return fileProposal(db, actor, input)
}

export async function prepareMonthClose(db: D1Database, actor: Agent, period: string) {
  const { start, end } = monthBounds(period), state = await closeState(db, period)
  requireThat(state.status !== 'locked', `${period} is locked; a person must decide whether to reopen it`, 409)
  const reconciliations: Data[] = [], corrections: Data[] = []
  for (const s of await all(db, 'SELECT id FROM pt_statements WHERE end_date <= ? ORDER BY end_date, id', end)) {
    const r = await reconciliationState(db, s.id)
    if (r.completed) { reconciliations.push({ statementId: s.id, status: 'done', evidence: `/app/bank?statement=${s.id}` }); continue }
    const periodLocked = await one(db, "SELECT id FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", r.statement.end_date)
    // Only a unique equal posting on the same date is mechanical. Ambiguous
    // candidates and absent source evidence stay unresolved; no account is guessed.
    for (const line of r.lines.filter((l: Data) => !l.match_id && !l.removed_at && !l.excluded_at)) {
      const postings = r.postings.filter((p: Data) => !p.match_id && p.amount === line.amount_cents && p.entry_date === line.posted_date)
      const competing = r.lines.filter((l: Data) => !l.match_id && l.amount_cents === line.amount_cents && l.posted_date === line.posted_date)
      if (!periodLocked && postings.length === 1 && competing.length === 1) {
        const p = await prepare(db, actor, { kind: 'match', summary: `Match ${line.description} to recorded entry ${postings[0].number}`, payload: { bankLineIds: [line.id], journalLineIds: [postings[0].id], create: [] } })
        corrections.push({ kind: 'match', statementId: s.id, lineId: line.id, postingId: postings[0].id, proposalId: p.id })
      }
    }
    const locked = periodLocked
    if (locked) r.blockers.push({ kind: 'locked', message: `A person must decide whether to reopen ${locked.id}` })
    if (r.ready && !locked) {
      const p = await prepare(db, actor, { kind: 'close-packet', summary: `Reconcile ${r.bank.name} through ${r.statement.end_date}`, payload: { period: r.statement.end_date.slice(0, 7), exceptions: [], statementId: s.id, fingerprint: await reconciliationFingerprint(r) } })
      reconciliations.push({ statementId: s.id, status: 'proposed', proposalId: p.id, evidence: `/app/bank?statement=${s.id}` })
    } else reconciliations.push({ statementId: s.id, status: 'needs-evidence', blockers: r.blockers, evidence: `/app/bank?statement=${s.id}` })
  }
  // Propose exact existing records, never an invented replacement posting.
  // Evidence and competing allocations remain visible rather than guessed.
  const proposeAction = async (payload: Data, summary: string, check: string) => {
    const refs = await mechanicalActionRefs(db, payload)
    const p = await prepare(db, actor, { kind: 'journal', summary, payload: { ...payload, period }, refs })
    corrections.push({ kind: payload.action, check, recordId: payload.id, proposalId: p.id })
  }
  for (const draft of await all(db, "SELECT * FROM pt_journal_entries WHERE status = 'draft' AND source_kind = 'manual' AND document_id IS NOT NULL AND entry_date BETWEEN ? AND ? ORDER BY entry_date, id", start, end)) {
    await proposeAction({ action: 'post-draft', id: draft.id, revision: draft.revision, date: draft.entry_date }, `Post supported draft: ${draft.memo}`, 'drafts')
  }
  const bills = await all(db, "SELECT b.*, (SELECT COUNT(*) FROM pt_documents d WHERE d.linked_kind = 'bill' AND d.linked_id = b.id) AS document_count, (SELECT COUNT(*) FROM pt_capture_drafts c WHERE c.bill_id = b.id) AS captured FROM pt_bills b WHERE b.bill_date <= ? AND b.status <> 'void' ORDER BY b.bill_date, b.id", end)
  for (const bill of bills.filter(b => b.status === 'draft' && b.bill_date >= start && b.document_count && !b.captured)) {
    await proposeAction({ action: 'post-bill', id: bill.id, revision: bill.revision, date: bill.bill_date }, `Record supported bill: ${bill.reference}`, 'drafts')
  }
  const invoices = await all(db, "SELECT * FROM pt_invoices WHERE issue_date <= ? AND void_date IS NULL ORDER BY issue_date, id", end)
  for (const inv of invoices.filter(i => ['draft', 'approved'].includes(i.status) && i.issue_date >= start && i.issue_date <= end)) {
    await proposeAction({ action: inv.status === 'draft' ? 'approve-invoice' : 'issue-invoice', id: inv.id, revision: inv.revision, date: inv.issue_date }, `${inv.status === 'draft' ? 'Approve' : 'Issue'} invoice: ${inv.number}`, 'drafts')
  }
  for (const i of invoices) i.open_cents = await openBalance(db, 'invoice', i.id, i.total_cents)
  for (const b of bills) b.open_cents = await openBalance(db, 'bill', b.id, b.total_cents)
  const payments = await all(db, "SELECT p.*, p.amount_cents - COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a WHERE a.source_kind = 'payment' AND a.source_id = p.id AND a.voided_by IS NULL), 0) AS unallocated_cents FROM pt_payments p WHERE p.reversal_id IS NULL AND p.payment_date <= ? ORDER BY p.payment_date, p.id", end)
  for (const p of payments) p.unallocated_cents -= await refunded(db, 'payment', p.id)
  for (const payment of payments.filter(p => !p.reversal_id && p.payment_date <= end && p.unallocated_cents > 0)) {
    const targets = payment.direction === 'received'
      ? invoices.filter(i => i.kind === 'invoice' && i.status === 'issued' && i.customer_id === payment.contact_id && i.issue_date <= end && i.open_cents > 0)
      : bills.filter(b => (b.status === 'posted' || b.opening) && b.status !== 'void' && b.vendor_id === payment.contact_id && b.bill_date <= end && b.open_cents > 0)
    const competing = payments.filter(p => !p.reversal_id && p.direction === payment.direction && p.contact_id === payment.contact_id && p.payment_date <= end && p.unallocated_cents > 0)
    if (targets.length !== 1 || competing.length !== 1 || targets[0].open_cents !== payment.unallocated_cents) continue
    const target = targets[0], day = [start, payment.payment_date, target.issue_date ?? target.bill_date].sort().at(-1)!
    await proposeAction({ action: 'allocate-payment', id: payment.id, date: day, allocations: [{ targetId: target.id, amount: (payment.unallocated_cents / 100).toFixed(2) }] }, `Apply supported payment ${payment.reference} to ${target.number ?? target.reference}`, 'unapplied')
  }
  const recognition = await recognitionView(db, end), recurring = await recurringJournalsView(db, end)
  const mechanical = state.checks.filter((c: Data) => !['proposals', 'questions'].includes(c.key)).map((c: Data) => ({
    key: c.key, title: c.title, status: c.ok ? 'done' : ['drafts', 'unapplied'].includes(c.key) && c.items?.length && c.items.every((item: Data) => corrections.some(x => x.check === c.key && x.recordId === item.id)) ? 'proposed' : c.key === 'bank' && reconciliations.length && reconciliations.every(r => ['done', 'proposed'].includes(r.status)) ? 'proposed' : 'needs-evidence', detail: c.detail,
    recommendation: c.ok ? 'No further mechanical action.' : `Resolve in the existing ${c.title.toLowerCase()} workflow; do not waive this check.`,
    evidence: c.items ?? [],
  }))
  const scheduleExceptions = [
    ...recognition.exceptions.map((x: Data) => ({ ...x, kind: 'recognition', evidence: '/app/close?period=' + period + '#recognition' })),
    ...recurring.exceptions.map((x: Data) => ({ ...x, kind: 'recurring-journal', evidence: '/app/close?period=' + period })),
  ]
  // Compare each income and expense account with the preceding calendar month.
  // Amounts are computed from posted lines; descriptions make no causal claim.
  const priorEnd = new Date(Date.parse(start + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
  const priorStart = priorEnd.slice(0, 7) + '-01'
  const lines = await all(db, `SELECT j.id, j.revision, j.entry_date, j.memo, a.id AS account_id, a.code, a.name, a.type,
    l.debit_cents, l.credit_cents FROM pt_journal_lines l JOIN pt_journal_entries j ON j.id = l.entry_id
    JOIN pt_accounts a ON a.id = l.account_id WHERE j.status = 'posted' AND a.type IN ('income', 'expense')
    AND j.entry_date BETWEEN ? AND ? ORDER BY a.code, j.entry_date, j.id, l.line_no`, priorStart, end)
  const variances: Data[] = []
  for (const id of [...new Set(lines.map(l => l.account_id))]) {
    const rows = lines.filter(l => l.account_id === id), account = rows[0]
    const amount = (r: Data) => account.type === 'income' ? r.credit_cents - r.debit_cents : r.debit_cents - r.credit_cents
    const current = rows.filter(r => r.entry_date >= start).reduce((n, r) => n + amount(r), 0)
    const prior = rows.filter(r => r.entry_date < start).reduce((n, r) => n + amount(r), 0)
    if (current === prior) continue
    const citations = [...new Set(rows.map(r => r.id))]
    const body = `${account.code} · ${account.name}: ${usd(current)} in ${period}, versus ${usd(prior)} in ${priorEnd.slice(0, 7)}; change ${usd(current - prior)}. Posted entries: ${[...new Map(rows.map(r => [r.id, r.memo])).values()].join('; ')}. These entries explain the arithmetic; the accountant reviews the business cause.`
    const p = await prepare(db, actor, { kind: 'variance-note', summary: `${period} variance · ${account.code}`, payload: { period, body, citations }, refs: rows.map(r => ({ kind: 'journal', id: r.id, revision: r.revision })) })
    variances.push({ accountId: id, currentCents: current, priorCents: prior, changeCents: current - prior, citations, proposalId: p.id })
  }
  const report = `/app/reports?report=trial-balance&to=${end}&basis=accrual`
  const judgments = [
    { kind: 'materiality', evidence: { report, variances }, recommendation: 'Review the listed changes and record which are material. No automatic materiality threshold or write-off is applied.' },
    { kind: 'estimates', evidence: { schedules: recognition.schedules.map(s => ({ id: s.id, revision: s.revision, kind: s.kind, amountCents: s.amount_cents, remainingCents: s.remaining_cents })), exceptions: scheduleExceptions }, recommendation: 'Review the approved accrual assumptions and remaining balances; change estimates only through a newly approved schedule revision.' },
    { kind: 'reclassification', evidence: { report, entries: [...new Set(lines.filter(l => l.entry_date >= start).map(l => l.id))] }, recommendation: 'Review the cited account coding. Retain it unless evidence supports an explicitly approved correcting entry.' },
    { kind: 'reopening', evidence: { period, status: state.status, requests: state.requests, approvals: state.approvals }, recommendation: 'Keep this period open while reviewing. Reopen an earlier locked period only through its existing request and independent approval workflow.' },
  ]
  const exceptions = judgments.map(j => `${j.kind}: ${j.recommendation}`)
  const unresolved = mechanical.filter((m: Data) => m.status !== 'done')
  const packet = await prepare(db, actor, { kind: 'close-packet', summary: `${period} coordinated close review`, payload: {
    period, exceptions, notes: `${unresolved.length} mechanical checks still need action; ${scheduleExceptions.length} schedule exceptions; ${reconciliations.filter(r => r.status === 'proposed').length} reconciliations proposed. Review the attached work list before completing judgment tasks.`,
    monthClose: { mechanical, reconciliations, corrections, scheduleExceptions, judgments, variances },
  }, refs: [...new Map(lines.map(l => [l.id, { kind: 'journal', id: l.id, revision: l.revision }])).values(), ...recognition.schedules.map(s => ({ kind: 'recognition-schedule', id: s.id, revision: s.revision })), ...recurring.templates.map((t: Data) => ({ kind: 'recurring-journal', id: t.id, revision: t.revision }))] })
  return { period, status: state.status, mechanical, reconciliations, corrections, scheduleExceptions, judgments, variances, packet }
}


export const monthCloseCommands: Record<string, Command> = {
  'month-close.schedule': { need: 'owner', async run(c, b) {
    const period = text(b.period, 'Period'); monthBounds(period)
    const id = text(b.agentId, 'Agent'), enabled = b.enabled === true
    requireThat(await one(c.db, 'SELECT 1 FROM pt_agents WHERE id = ? AND active = 1', id), 'Choose an active agent', 409)
    await run(c.db, [authority(c.actor, 'owner'),
      q('INSERT INTO pt_month_close_schedules (agent_id, period, enabled, approved_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(agent_id, period) DO UPDATE SET enabled = excluded.enabled, approved_by = excluded.approved_by, updated_at = excluded.updated_at', id, period, enabled ? 1 : 0, c.actor.email, now()),
      audit(who(c.actor), 'month-close.schedule', 'agent', id, { period, enabled })])
    return { agentId: id, period, enabled }
  } },
}

/** Called after approved schedules have run. Disabled agents and locked periods
 * are excluded; preparation can never decide, send, reopen or lock. */
export async function runMonthCloses(db: D1Database, today: string) {
  const rows = await all(db, `SELECT a.*, s.period FROM pt_month_close_schedules s JOIN pt_agents a ON a.id = s.agent_id
    WHERE s.enabled = 1 AND a.active = 1 AND s.period <= ?
    AND NOT EXISTS (SELECT 1 FROM pt_periods p WHERE p.id = s.period AND p.status = 'locked') ORDER BY s.period, a.id`, today.slice(0, 7))
  for (const a of rows) await prepareMonthClose(db, { kind: 'agent', id: a.id, email: `agent:${a.name}`, name: a.name, tokenHash: a.token_hash }, a.period)
}
