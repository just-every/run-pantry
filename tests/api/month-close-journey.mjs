import assert from 'node:assert/strict'
import { books } from './harness.mjs'

export async function monthCloseScenario(h) {
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'synthetic-pantry-1', institution: 'Synthetic bank', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-08-31', openingBalance: '1000.00' })
  const post = async (date, memo, debit, credit, amount) => {
    const d = await h.command('journal.save-draft', { date, memo, lines: [{ accountId: debit, debit: amount }, { accountId: credit, credit: amount }] })
    return h.command('journal.post', { id: d.id, revision: d.revision })
  }
  await post('2026-08-31', 'synthetic-pantry-2 opening', acct['1000'], acct['3000'], '1000.00')
  const income = await post('2026-09-05', 'synthetic-pantry-3 service income', acct['1000'], acct['4000'], '250.00')
  const expense = await post('2026-09-20', 'synthetic-pantry-4 office expense', acct['6000'], acct['1000'], '125.00')
  const imported = await h.command('statement.import', { bankAccountId: bank.id, fileName: 'synthetic-pantry-5.csv', content: 'Date,Description,Amount\n2026-09-05,Synthetic income,250.00\n2026-09-20,Synthetic expense,-125.00\n', opening: '1000.00', closing: '1125.00', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })
  const r = await h.view('reconciliation/' + imported.statement.id)
  for (const [date, entry] of [['2026-09-05', income], ['2026-09-20', expense]]) {
    const l = r.lines.find(l => l.posted_date === date), p = r.postings.find(p => p.entry_date === date)
    if (!l.match_id) await h.command('match.approve', { bankLineIds: [l.id], journalLineIds: [p.id] })
  }
  const accrued = await h.command('account.save', { code: '2310', name: 'synthetic-pantry-6 accrued office costs', type: 'liability' })
  const schedule = await h.command('recognition.save', { name: 'synthetic-pantry-7 September accrual', kind: 'accrual', amount: '32.00', startDate: '2026-09-30', months: 1, balanceAccountId: accrued.id, recognitionAccountId: acct['6000'] })
  await h.command('recognition.approve', { id: schedule.id, revision: schedule.revision })
  const recurring = await h.command('recurring-journal.save', { name: 'synthetic-pantry-14 monthly allocation', memo: 'synthetic-pantry-15 office allocation', startDate: '2026-09-15', endDate: '2026-09-15', mode: 'post', cadence: 'month', every: 1, lines: [{ accountId: acct['6000'], debit: '5.00' }, { accountId: acct['3000'], credit: '5.00' }] })
  await h.command('recurring-journal.approve', { id: recurring.id, revision: recurring.revision })
  await h.cron(Date.parse('2026-10-01T12:00:00Z'))
  return { bank, income, expense, statement: imported.statement, schedule, recurring, acct }
}

export async function monthCloseJourney(h) {
  const s = await monthCloseScenario(h), agent = await h.agent('synthetic-pantry-8')
  const report = await agent.call('month-close', { period: '2026-09' })
  assert.deepEqual(report.reconciliations.map(r => r.status), ['proposed'])
  assert.deepEqual(report.judgments.map(j => j.kind), ['materiality', 'estimates', 'reclassification', 'reopening'])
  assert.equal(report.judgments[0].evidence.variances.find(v => v.accountId === s.acct['4000']).changeCents, 25000)
  assert.equal(report.judgments[1].evidence.schedules[0].amountCents, 3200)
  assert.deepEqual(report.judgments[2].evidence.entries.includes(s.expense.id), true)
  assert.equal(report.judgments[3].evidence.status, 'open')
  assert.ok(report.judgments.every(j => j.recommendation.length > 20))
  assert.deepEqual(report.mechanical.map(c => c.key).sort(), ['bank', 'drafts', 'evidence', 'feeds', 'recognition', 'subledgers', 'trial-balance', 'unapplied'])
  assert.deepEqual(report.mechanical.filter(c => c.status !== 'done').map(c => c.key), ['bank'])
  assert.deepEqual(report.scheduleExceptions, [])
  const recurring = (await h.view('recurring-journals')).templates.find(t => t.id === s.recurring.id)
  assert.deepEqual(recurring.runs_list.map(r => [r.occurrence, r.status]), [['2026-09-15', 'posted']])
  const recurringEntry = await h.view('reports/record/entry/' + recurring.runs_list[0].journal_id)
  assert.deepEqual(recurringEntry.entries[0].lines.map(l => [l.debit, l.credit]), [[500, 0], [0, 500]])

  const recognition = await h.view('recognition?to=2026-10-01')
  const runs = recognition.schedules.find(x => x.id === s.schedule.id).runs_list
  assert.equal(runs.filter(r => r.status === 'posted').length, 2)
  const accrual = await h.view('reports/record/entry/' + runs.find(r => r.entry_date === '2026-09-30').journal_id)
  const reversal = await h.view('reports/record/entry/' + runs.find(r => r.entry_date === '2026-10-01').journal_id)
  assert.ok(reversal.links.some(l => l.id === accrual.id))
  const incomeVariance = report.variances.find(v => v.accountId === s.acct['4000'])
  assert.deepEqual([incomeVariance.currentCents, incomeVariance.priorCents, incomeVariance.changeCents], [25000, 0, 25000])
  assert.deepEqual(incomeVariance.citations, [s.income.id])
  const expenseVariance = report.variances.find(v => v.accountId === s.acct['6000'])
  assert.deepEqual([expenseVariance.currentCents, expenseVariance.priorCents, expenseVariance.changeCents], [16200, 0, 16200])
  for (const v of report.variances) for (const id of v.citations) assert.equal((await h.view('reports/record/entry/' + id)).id, id)
  const repeat = await agent.call('month-close', { period: '2026-09' })
  assert.equal(repeat.packet.id, report.packet.id)
  assert.deepEqual(repeat.variances.map(v => v.proposalId), report.variances.map(v => v.proposalId))
  const p = await agent.call('proposals/' + report.reconciliations[0].proposalId)
  await h.command('member.save', { email: 'synthetic-pantry-9@example.test', name: 'Synthetic viewer', role: 'viewer' })
  const invitation = h.mail.findLast(m => [m.to].flat().includes('synthetic-pantry-9@example.test'))
  const inviteToken = new URL(invitation.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
  const confirmed = await h.send('/auth/confirm', { token: inviteToken }, { headers: { 'x-synthetic-pantry-clock': '2026-10-01T12:00:00Z' } })
  assert.equal(confirmed.status, 303)
  const viewer = confirmed.cookie
  await h.command('proposal.decide', { id: p.id, revision: p.revision }, viewer, 403)
  assert.equal((await h.send('/api/pantry/command/period.lock', { period: '2026-09' }, { headers: { authorization: 'Bearer ' + agent.token } })).status, 401)
  // A changed statement proof cannot be approved using the old snapshot.
  const r = await h.view('reconciliation/' + s.statement.id), first = r.lines[0]
  await h.command('match.undo', { id: first.match_id, reason: 'synthetic-pantry-10 proof changed' })
  await h.command('proposal.decide', { id: p.id, revision: p.revision }, undefined, 409)
  const blocked = await agent.call('month-close', { period: '2026-09' })
  assert.equal(blocked.reconciliations[0].status, 'needs-evidence')
  assert.ok(blocked.reconciliations[0].blockers.some(b => b.kind === 'unmatched'))
  assert.deepEqual(blocked.corrections.map(c => [c.kind, c.lineId]), [['match', first.id]])
  assert.equal(blocked.mechanical.find(c => c.key === 'bank').status, 'needs-evidence')
  const correction = await agent.call('proposals/' + blocked.corrections[0].proposalId)
  const effects = (await h.command('proposal.preview', { id: correction.id, revision: correction.revision })).effects
  assert.deepEqual(effects.bases.accrual.before, effects.bases.accrual.after)
  await h.command('proposal.decide', { id: correction.id, revision: correction.revision, previewToken: effects.token })
  const refreshed = await agent.call('month-close', { period: '2026-09' })
  const fresh = await agent.call('proposals/' + refreshed.reconciliations[0].proposalId)
  await h.command('proposal.decide', { id: fresh.id, revision: fresh.revision })
  assert.ok((await h.view('reconciliation/' + s.statement.id)).completed)
  assert.equal((await h.view('close/2026-09')).status, 'open')
  const readyReport = await agent.call('month-close', { period: '2026-09' })
  assert.deepEqual(readyReport.mechanical.filter(c => c.status !== 'done'), [])
  // Packet approval creates exactly four protected judgment tasks.
  const member = async (email, role, grants = {}) => {
    // Auth uses the session clock; the ledger remains fixed to the seeded month.
    const sessionClock = new Date().toISOString()
    const invited = await h.send('/api/pantry/command/member.save', { email, name: 'Synthetic reviewer', role, ...grants }, { cookie: h.owner, headers: { 'x-synthetic-pantry-clock': sessionClock } })
    assert.equal(invited.status, 200)
    const message = h.mail.findLast(m => [m.to].flat().includes(email))
    const token = new URL(message.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
    const response = await h.send('/auth/confirm', { token }, { headers: { 'x-synthetic-pantry-clock': sessionClock } })
    assert.equal(response.status, 303)
    return response.cookie
  }
  const bea = await member('synthetic-pantry-12@example.test', 'bookkeeper')
  const ann = await member('synthetic-pantry-13@example.test', 'accountant', { canLock: true })
  await h.command('proposal.decide', { id: readyReport.packet.id, revision: readyReport.packet.revision }, bea, 403)
  await h.command('proposal.decide', { id: readyReport.packet.id, revision: readyReport.packet.revision }, ann)
  let close = await h.view('close/2026-09')
  const judgments = close.tasks.filter(t => t.judgment_kind)
  assert.deepEqual(judgments.map(t => t.judgment_kind).sort(), ['estimates', 'materiality', 'reclassification', 'reopening'])
  for (const task of judgments) {
    await h.command('close.task', { id: task.id, revision: task.revision }, bea, 403)
    await h.command('close.task-save', { id: task.id, revision: task.revision, title: 'Bypass judgment' }, bea, 403)
    await h.command('close.task', { id: task.id, revision: task.revision, note: 'Reviewed the cited evidence; retain the recommended treatment.' }, ann)
  }
  close = await h.view('close/2026-09')
  assert.equal(close.status, 'open')
  assert.ok(close.tasks.filter(t => t.judgment_kind).every(t => t.done_by === 'synthetic-pantry-13@example.test'))
  // Resolve every pending proposal through its public approval door before lock.
  for (const pending of (await h.view('proposals')).proposals.filter(p => p.status === 'proposed')) {
    await h.command('proposal.decide', { id: pending.id, revision: pending.revision, decision: pending.kind === 'variance-note' ? 'approve' : 'reject' }, ann)
  }
  assert.equal((await h.view('close/2026-09')).ready, true)
  await h.command('period.lock', { period: '2026-09' }, bea, 403)
  await h.command('period.lock', { period: '2026-09' }, ann)
  assert.equal((await h.view('close/2026-09')).status, 'locked')
  const finishedTask = (await h.view('close/2026-09')).tasks.find(t => t.judgment_kind)
  await h.command('close.task', { id: finishedTask.id, revision: finishedTask.revision, done: false }, ann, 409)
  await agent.call('month-close', { period: '2026-09' }, 409)

  await agent.call('month-close', { period: 'bad-month' }, 400)
  // Scheduling is opt-in, uses the existing approved schedules, is repeatable,
  // and stops when the agent is disabled.
  const row = (await h.view('state')).settings.agents.find(a => a.name === 'synthetic-pantry-8')
  await h.command('month-close.schedule', { agentId: row.id, period: '2026-10', enabled: true }, bea, 403)
  await h.command('month-close.schedule', { agentId: row.id, period: '2026-10', enabled: true })
  await h.cron(Date.parse('2026-10-02T12:00:00Z'))
  let proposals = (await agent.call('context')).proposals.filter(p => p.payload.monthClose && p.payload.period === '2026-10')
  assert.equal(proposals.length, 1)
  await h.cron(Date.parse('2026-10-02T12:30:00Z'))
  assert.equal((await agent.call('context')).proposals.filter(p => p.payload.monthClose && p.payload.period === '2026-10').length, 1)
  await h.command('month-close.schedule', { agentId: row.id, period: '2026-11', enabled: true })
  await h.command('agent.deactivate', { id: row.id })
  await h.cron(Date.parse('2026-11-02T12:00:00Z'))
  assert.equal((await h.view('proposals')).proposals.filter(p => p.payload.monthClose && p.payload.period === '2026-11').length, 0)
  await agent.call('month-close', { period: '2026-11' }, 401)
}
