import test from 'node:test'
import assert from 'node:assert/strict'
import { at, fixture, harness } from './harness.mjs'
import { importStatements, matchSeptember, september } from './scenario.mjs'

/** A reply as a mail client writes it: the owner's words above the quoted question. */
const reply = (from, to, subject, words) => [`From: Olivia Owner <${from}>`, `To: ${to}`, `Subject: Re: ${subject}`, `Message-ID: <${crypto.randomUUID()}@mail.example.test>`, `Date: ${new Date().toUTCString()}`,
  'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', words, '', 'On Sat, Oct 17, 2026, Juniper Lane Design books wrote:', '> What was the $1,250.00 ...', ''].join('\r\n')

test('emailed financial answers wait for authenticated native confirmation', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await september(h), st = await importStatements(h, s)
  await matchSeptember(h, s, st)
  const october = (await fixture('bank/operating-checking-2026-10.csv')).split('\n').slice(0, 4).join('\n') + '\nCREDIT,10/06/2026,"STRIPE TRANSFER ST-X7Y2",1250.00,ACH_CREDIT,28885.64,\n'
  await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'operating-checking-2026-10a.csv', content: october, opening: '27797.02', closing: '28885.64', start: '2026-10-01', end: '2026-10-08', confirmLast4: '4821' })
  const settings = (await h.view('questions')).agent.settings
  await h.command('books-agent.save', { ...settings, emailOn: true, perDay: 20, depositDays: 0, fileDays: 0, receiptAmount: '75.00' })
  const box = (await h.command('receipt-address.create', { mailbox: 'books@example.test' })).address
  await h.command('books-agent.run', {})

  let view = await h.view('questions')
  const missing = at(view.open, q => q.kind === 'missing-receipt' && q.subject_id === s.bills.harbor.id)
  const missingMail = h.mail.find(m => m.subject.includes(missing.ref))
  await h.email(reply('owner@example.test', box, missingMail.subject, '2 lost it'), { from: 'owner@example.test', to: box })
  view = await h.view('questions')
  let pending = at(view.open, q => q.id === missing.id)
  assert.equal(pending.status, 'confirm')
  assert.equal(pending.pending.choice, 'no-receipt')
  assert.equal((await h.view('sales')).bills.find(b => b.id === s.bills.harbor.id).evidence_waived, null)
  await h.command('question.confirm', { id: missing.id, yes: true })
  assert.equal(at((await h.view('questions')).settled, q => q.id === missing.id).status, 'filed')
  assert.match((await h.view('sales')).bills.find(b => b.id === s.bills.harbor.id).evidence_waived, /lost it/)

  view = await h.view('questions')
  const category = at(view.open, q => q.subject_kind === 'bank-line' && q.choices[0]?.action.type === 'category')
  const categoryMail = h.mail.find(m => m.subject.includes(category.ref))
  const posted = (await h.view('journal')).entries.filter(e => e.status === 'posted').length
  await h.email(reply('owner@example.test', box, categoryMail.subject, '1'), { from: 'owner@example.test', to: box })
  await h.email(reply('owner@example.test', box, categoryMail.subject, 'yes'), { from: 'owner@example.test', to: box })
  pending = at((await h.view('questions')).open, q => q.id === category.id)
  assert.equal(pending.status, 'confirm')
  assert.equal((await h.view('journal')).entries.filter(e => e.status === 'posted').length, posted)
  await h.command('question.confirm', { id: category.id, yes: true })
  assert.equal(at((await h.view('questions')).settled, q => q.id === category.id).status, 'filed')
  assert.equal((await h.view('journal')).entries.filter(e => e.status === 'posted').length, posted + 1)
})

test('BOOKS-AGENT the agent asks the owner what does not add up, by email first; the answer files it and the agent learns the rule only when told', async t => {
  const model = []
  // The install's AI model at its network edge: it reads the owner's words into one of the offered answers.
  const h = await harness({ async outbound(request) {
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(request.headers.get('x-api-key'), 'owner-test-key')
    const body = await request.json(), prompt = body.messages[0].content
    model.push(prompt)
    const answer = body.system.includes('owner’s answer') || body.system.includes("owner's answer")
      ? { understood: true, choice: null, category: '4000', remember: true, note: 'Stripe payout of workshop sales' }
      : { category: null }
    return Response.json({ content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn' })
  } })
  t.after(() => h.close())
  const s = await september(h), st = await importStatements(h, s)
  await matchSeptember(h, s, st)
  // Early October, in the layout of the October fixture (every date already past, so each line is old enough to ask about).
  const october = (await fixture('bank/operating-checking-2026-10.csv')).split('\n').slice(0, 4).join('\n') + '\nCREDIT,10/06/2026,"STRIPE TRANSFER ST-X7Y2",1250.00,ACH_CREDIT,28885.64,\n'
  await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'operating-checking-2026-10a.csv', content: october, opening: '27797.02', closing: '28885.64', start: '2026-10-01', end: '2026-10-08', confirmLast4: '4821' })
  const settings = (await h.view('questions')).agent.settings
  await h.command('books-agent.save', { ...settings, emailOn: true, perDay: 20, depositDays: 0, fileDays: 0, receiptAmount: '75.00' })
  // Replies come back to the Pantry address the owner routed to this install.
  const box = (await h.command('receipt-address.create', { mailbox: 'books@example.test' })).address
  const entries = async () => (await h.view('journal')).entries.filter(e => e.status === 'posted').length
  const posted = await entries()

  // No model key: the rule checks still run, and the page says so.
  const run = (await h.command('books-agent.run', {})).run
  assert.equal(run.model, 'missing')
  let view = await h.view('questions')
  assert.match(view.agent.model.line, /built-in rules/)
  const stripe = at(view.open, x => x.kind === 'unmatched-deposit' && x.facts['The bank says'].includes('STRIPE TRANSFER'))
  assert.match(stripe.question, /\$1,250\.00/)
  assert.ok(view.open.some(x => x.kind === 'unfiled' && x.facts['The bank says'].includes('ADOBE')))
  assert.ok(view.open.some(x => x.kind === 'missing-receipt' && x.subject_id === s.bills.harbor.id))
  assert.equal(await entries(), posted, 'asking posts nothing')

  // By email first: one plain question per email, with a link to the exact record.
  const sent = h.mail.filter(m => /\[Pantry [A-Z2-9]{10}\]/.test(m.subject))
  assert.equal(sent.length, view.open.length)
  assert.equal(run.emailed, sent.length)
  const asked = sent.find(m => m.subject.includes(stripe.ref))
  assert.ok(asked, 'the deposit question was emailed')
  assert.deepEqual([asked.to].flat(), ['owner@example.test'])
  assert.equal(asked.reply_to, box)
  assert.ok(asked.text.includes(`/app/questions?q=${stripe.id}`))
  assert.match(asked.text, /1\. .+\n {3}.*net income/)

  // A reply in the owner's own words is kept but not guessed at without a model.
  const words = 'That was our Stripe payout for the workshop sales. Always file Stripe that way.'
  assert.equal((await h.email(reply('owner@example.test', box, asked.subject, words), { from: 'owner@example.test', to: box })).status, 200)
  let q = at((await h.view('questions')).open, x => x.id === stripe.id)
  assert.equal(q.status, 'open')
  assert.ok(q.messages.some(m => m.via === 'email' && m.body.startsWith('That was our Stripe payout')))

  // Someone else cannot answer for the owner, even with the reference.
  await h.email(reply('mallory@example.test', box, asked.subject, '1'), { from: 'mallory@example.test', to: box })
  assert.equal(at((await h.view('questions')).open, x => x.id === stripe.id).status, 'open')

  // With the install's own key, the same words are read into an answer that waits for the owner's yes.
  await h.command('reader.save', { provider: 'anthropic', key: 'owner-test-key' })
  await h.email(reply('owner@example.test', box, asked.subject, words), { from: 'owner@example.test', to: box })
  assert.ok(model.at(-1).includes('Stripe payout for the workshop sales'))
  q = at((await h.view('questions')).open, x => x.id === stripe.id)
  assert.equal(q.status, 'confirm')
  assert.equal(q.pending.accountId, s.acct['4000'])
  assert.equal(q.pending.effects.netIncome.after - q.pending.effects.netIncome.before, 125000)
  assert.equal(q.pending.effects.bases.accrual.after.cashFlow.ties, true)
  assert.equal(await entries(), posted, 'nothing is filed before the yes')
  const confirmMail = h.mail.findLast(m => m.subject.includes(stripe.ref))
  assert.ok(confirmMail)

  // A From header cannot confirm the change. The signed-in owner confirms it in Pantry.
  await h.email(reply('owner@example.test', box, confirmMail.subject, 'Yes'), { from: 'owner@example.test', to: box })
  view = await h.view('questions')
  q = at(view.open, x => x.id === stripe.id)
  assert.equal(q.status, 'confirm')
  assert.equal(await entries(), posted)
  await h.command('question.confirm', { id: stripe.id, yes: true })
  q = at((await h.view('questions')).settled, x => x.id === stripe.id)
  assert.deepEqual([q.status, q.answered_via, q.answered_by, q.result_kind], ['filed', 'app', 'owner@example.test', 'match'])
  assert.equal(await entries(), posted + 1)
  const line = at((await h.view('bank/lines')).lines, l => l.description.includes('STRIPE TRANSFER'))
  assert.deepEqual(line.filed_to, ['Service revenue'])
  const rule = at((await h.view('bank/rules')).rules, r => r.id === q.rule_id)
  assert.equal(rule.payee, 'Stripe')
  const tb = await h.view('reports/trial-balance?to=2026-10-31&basis=accrual')
  assert.equal(tb.balanced, true)

  // Learned: the next Stripe payout files itself by the rule; nobody is asked about it.
  await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'operating-checking-2026-10b.csv', content: 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nCREDIT,10/13/2026,"STRIPE TRANSFER ST-Q4M1",980.00,ACH_CREDIT,29865.64,\n', opening: '28885.64', closing: '29865.64', start: '2026-10-09', end: '2026-10-15', confirmLast4: '4821' })
  assert.equal(at((await h.view('bank/lines')).lines, l => l.description.includes('ST-Q4M1')).rule_id, rule.id)
  await h.command('books-agent.run', {})
  assert.ok(!(await h.view('questions')).open.some(x => x.facts['The bank says']?.includes('ST-Q4M1')))

  // In the app: a chosen answer files it without a rule unless asked; a receipt question takes the file.
  const adobe = at((await h.view('questions')).open, x => x.kind === 'unfiled' && x.record_date === '2026-10-02')
  const effects = (await h.command('question.preview', { id: adobe.id, accountId: s.acct['6200'] })).effects
  assert.equal(effects.netIncome.after - effects.netIncome.before, adobe.amount_cents)
  const filed = await h.command('question.answer', { id: adobe.id, accountId: s.acct['6200'], date: effects.date, previewToken: effects.token })
  assert.equal(filed.question.status, 'filed')
  assert.equal(filed.question.rule_id, null)
  assert.equal((await h.view('reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=accrual')).netIncome, effects.netIncome.after)
  const harbor = at((await h.view('questions')).open, x => x.subject_id === s.bills.harbor.id)
  await h.command('question.receipt', { id: harbor.id, name: 'harbor-lease.pdf', mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.4 lease').toString('base64') })
  assert.ok((await h.view('documents')).documents.some(d => d.name === 'harbor-lease.pdf' && d.linked_id === s.bills.harbor.id))

  // At close, the month's questions are one thread; what is still open says why, and blocks the lock.
  const close = await h.view('close/2026-10')
  const check = at(close.checks, c => c.key === 'questions')
  assert.equal(check.ok, false)
  assert.match(check.detail, /still open: .*no answer yet/)
  const thread = at(close.questions, x => x.id === stripe.id).messages.map(m => m.via)
  assert.deepEqual(thread.slice(0, 2), ['agent', 'agent'])
  assert.ok(thread.filter(v => v === 'email').length >= 3)
})

test('REPORT-005 / CLOSE-003 / ACCOUNTANT questions carry their entry or report, can be answered at close or by the invited recipient’s email, and survive agent checks', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await september(h)
  const accountant = await h.member('jordan@example.test', 'accountant', { canLock: true })
  const viewer = await h.member('viewer@example.test', 'viewer')
  const box = (await h.command('receipt-address.create', { mailbox: 'books@example.test' })).address
  const entry = (await h.view('journal')).entries.find(e => e.status === 'posted')
  const q = (await h.command('question.ask', { subjectKind: 'journal', subjectId: entry.id, question: 'Does this opening entry agree to the prior year?', assignee: 'jordan@example.test' })).question
  assert.equal(q.subject_id, entry.id)
  assert.equal(q.assignee, 'jordan@example.test')
  assert.equal(q.kind, 'accountant')
  await h.command('books-agent.run', {})
  assert.ok((await h.view('questions')).open.some(x => x.id === q.id), 'agent does not silently settle a person’s question')
  const close = await h.view(`close/${q.period}`, accountant)
  assert.equal(at(close.checks, c => c.key === 'questions').ok, false)
  assert.ok(close.questions.some(x => x.id === q.id && x.facts.Record))
  const boardWaiting = async period => (await h.view('close-board?year=' + period.slice(0, 4))).months.find(m => m.id === period).waiting
  const waitingBefore = await boardWaiting(q.period)
  assert.ok(waitingBefore > 0)
  await h.command('question.answer', { id: q.id, words: 'Agreed to the signed trial balance.' }, viewer, 403)
  const done = await h.command('question.answer', { id: q.id, words: 'Agreed to the signed trial balance.' }, accountant)
  assert.equal(done.heard.question.status, 'answered')
  assert.equal(done.heard.question.answered_by, 'jordan@example.test')
  assert.equal(await boardWaiting(q.period), waitingBefore - 1)
  const report = { report: 'profit-and-loss', line: 'net-income', from: '2026-09-01', to: '2026-09-30', basis: 'accrual' }
  const figure = (await h.command('question.ask', { subjectKind: 'report-line', subjectId: JSON.stringify(report), question: 'Is this September profit ready for review?', assignee: 'jordan@example.test' })).question
  assert.equal(figure.record_date, report.to)
  const mail = h.mail.find(m => m.subject.includes(figure.ref))
  assert.deepEqual([mail.to].flat(), ['jordan@example.test'])
  await h.email(reply('owner@example.test', box, mail.subject, 'An unrelated sender cannot answer.'), { from: 'owner@example.test', to: box })
  assert.ok((await h.view('questions')).open.some(x => x.id === figure.id))
  const beforeEmail = await boardWaiting(figure.period)
  await h.email(reply('jordan@example.test', box, mail.subject, 'Yes, the September income is complete.'), { from: 'jordan@example.test', to: box })
  const answered = at((await h.view('questions')).settled, x => x.id === figure.id)
  assert.equal(answered.status, 'answered')
  assert.equal(answered.answered_via, 'email')
  assert.equal(await boardWaiting(figure.period), beforeEmail - 1)
  assert.ok(answered.messages.some(m => m.body === 'Yes, the September income is complete.'))
  // A mention can ask the current owner, retaining their authenticated email answer on the deposit.
  await importStatements(h, s)
  const depositLine = (await h.view('bank/lines')).lines.find(l => l.amount_cents > 0)
  assert.ok(depositLine)
  const ownerQuestion = (await h.command('question.ask', { subjectKind: 'bank-line', subjectId: depositLine.id, question: 'What customer does this deposit belong to?', assignee: '@owner@example.test' }, accountant)).question
  assert.equal(ownerQuestion.assignee, 'owner@example.test')
  const ownerMail = h.mail.find(m => m.subject.includes(ownerQuestion.ref))
  assert.deepEqual([ownerMail.to].flat(), ['owner@example.test'])
  const ownerWaiting = await boardWaiting(ownerQuestion.period)
  await h.email(reply('jordan@example.test', box, ownerMail.subject, 'Wrong recipient.'), { from: 'jordan@example.test', to: box })
  assert.equal(await boardWaiting(ownerQuestion.period), ownerWaiting)
  await h.email(reply('owner@example.test', box, ownerMail.subject, 'This is the Cedar Studio deposit.'), { from: 'owner@example.test', to: box })
  const depositThread = await h.view(`questions/record?kind=bank-line&id=${depositLine.id}`)
  const ownerAnswered = depositThread.questions.find(q => q.id === ownerQuestion.id)
  assert.deepEqual([ownerAnswered.answer, ownerAnswered.answered_by, ownerAnswered.answered_via], ['This is the Cedar Studio deposit.', 'owner@example.test', 'email'])
  assert.equal(await boardWaiting(ownerQuestion.period), ownerWaiting - 1)
  const bookkeeper = await h.member('close-bookkeeper@example.test', 'bookkeeper')
  const bookkeeperQuestion = (await h.command('question.ask', { subjectKind: 'journal', subjectId: entry.id, question: 'Please confirm the opening balance.', assignee: '@close-bookkeeper@example.test' })).question
  const bookkeeperMail = h.mail.find(m => m.subject.includes(bookkeeperQuestion.ref))
  await h.email(reply('close-bookkeeper@example.test', box, bookkeeperMail.subject, 'Confirmed against the statement.'), { from: 'close-bookkeeper@example.test', to: box })
  assert.equal((await h.view('questions', bookkeeper)).settled.find(q => q.id === bookkeeperQuestion.id).answered_via, 'email')
  await h.command('member.save', { email: 'close-bookkeeper@example.test', name: 'Restricted bookkeeper', role: 'bookkeeper', bankAccounts: [] })
  assert.ok(!(await h.view('questions')).recipients.some(p => p.email === 'close-bookkeeper@example.test'))
  await h.command('question.ask', { subjectKind: 'journal', subjectId: entry.id, question: 'Restricted recipient refused.', assignee: '@close-bookkeeper@example.test' }, h.owner, 400)
  // Existing bank findings can be routed to the accountant, who uses the same supported filing choices.
  await importStatements(h, s)
  await h.command('books-agent.run', {})
  const deposit = (await h.view('questions')).open.find(x => x.kind === 'unmatched-deposit')
  assert.ok(deposit)
  await h.command('question.assign', { id: deposit.id, assignee: 'jordan@example.test' })
  const routed = h.mail.findLast(m => m.subject.includes(deposit.ref))
  assert.deepEqual([routed.to].flat(), ['jordan@example.test'])
  // Matching a recorded posting adds no ledger activity; paying the open bill
  // projects its real payment-basis reports, including unknown 1099 methods.
  let pending = (await h.view('questions')).open
  const recorded = at(pending, q => q.subject_kind === 'bank-line' && q.choices.some(c => c.action.type === 'posting'))
  const posting = recorded.choices.find(c => c.action.type === 'posting')
  const matchEffects = (await h.command('question.preview', { id: recorded.id, choice: posting.id }, accountant)).effects
  assert.deepEqual(matchEffects.bases.accrual.before, matchEffects.bases.accrual.after)
  await h.command('question.answer', { id: recorded.id, choice: posting.id, date: matchEffects.date, previewToken: matchEffects.token }, accountant)
  await h.command('contractor.save', { contactId: s.c['Brightline Software'].id, is1099: true })
  pending = (await h.view('questions')).open
  const payable = at(pending, q => q.subject_kind === 'bank-line' && q.choices.some(c => c.action.type === 'bill'))
  const bill = payable.choices.find(c => c.action.type === 'bill')
  const paidEffects = (await h.command('question.preview', { id: payable.id, choice: bill.id }, accountant)).effects
  const before1099 = paidEffects.bases.accrual.before.contractors.vendors.find(v => v.id === s.c['Brightline Software'].id)
  const after1099 = paidEffects.bases.accrual.after.contractors.vendors.find(v => v.id === before1099.id)
  assert.equal(after1099.unrecorded - before1099.unrecorded, 64000)
  assert.equal(paidEffects.bases.cash.after.profitAndLoss.netIncome - paidEffects.bases.cash.before.profitAndLoss.netIncome, -64000)
  await h.command('question.answer', { id: payable.id, choice: bill.id, date: paidEffects.date, previewToken: paidEffects.token }, accountant)
  const taxYear = await h.view('reports/contractors?year=2026')
  assert.equal(taxYear.contractors.find(v => v.id === before1099.id).unrecorded, after1099.unrecorded)
  // The tax reports carry their server-resolved figure too, without copying tax identifiers.
  await h.command('contractor.save', { contactId: s.c['Harbor Office Rentals'].id, is1099: true })
  for (const scope of [
    { report: 'sales-tax', line: 'total', from: '2026-09-01', to: '2026-09-30', basis: 'accrual' },
    { report: 'trial-balance', line: s.acct['1000'], from: '2026-09-01', to: '2026-09-30', basis: 'accrual' },
    { report: 'trial-balance', line: JSON.stringify(['total', 'debit']), from: '2026-09-01', to: '2026-09-30', basis: 'cash' },
    { report: 'general-ledger', line: JSON.stringify([s.acct['1000'], 'closing']), from: '2026-09-01', to: '2026-09-30', basis: 'accrual' },
    { report: 'contractors', line: s.c['Harbor Office Rentals'].id, from: '2026-01-01', to: '2026-12-31', basis: 'cash' },
  ]) {
    const asked = (await h.command('question.ask', { subjectKind: 'report-line', subjectId: JSON.stringify(scope), question: 'Please confirm this report line.', assignee: 'jordan@example.test' })).question
    const source = await h.view(`questions/record?kind=report-line&id=${encodeURIComponent(JSON.stringify(scope))}`)
    assert.ok(source.questions.some(q => q.id === asked.id && q.facts.Figure && q.facts.Amount))
    assert.ok(!Object.keys(asked.facts).some(k => /TIN/i.test(k)))
  }
  // Revocation closes the email door even when a reply still has the thread reference.
  await h.db.prepare("UPDATE pt_members SET active = 0 WHERE email = ?").bind('jordan@example.test').run()
  await h.email(reply('jordan@example.test', box, routed.subject, '1'), { from: 'jordan@example.test', to: box })
  assert.ok((await h.view('questions')).open.some(x => x.id === deposit.id))
  await h.command('question.ask', { subjectKind: 'journal', subjectId: 'missing', question: 'Does this exist?', assignee: 'viewer@example.test' }, h.owner, 400)
})
