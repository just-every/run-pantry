import test from 'node:test'
import assert from 'node:assert/strict'
import { at, fixture, harness } from './harness.mjs'
import { importStatements, matchSeptember, september } from './scenario.mjs'

/** A reply as a mail client writes it: the owner's words above the quoted question. */
const reply = (from, to, subject, words) => [`From: Olivia Owner <${from}>`, `To: ${to}`, `Subject: Re: ${subject}`, `Message-ID: <${crypto.randomUUID()}@mail.example.test>`, `Date: ${new Date().toUTCString()}`,
  'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', words, '', 'On Sat, Oct 17, 2026, Juniper Lane Design books wrote:', '> What was the $1,250.00 ...', ''].join('\r\n')

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
  assert.equal(await entries(), posted, 'nothing is filed before the yes')
  const confirmMail = h.mail.findLast(m => m.subject.includes(stripe.ref))
  assert.match(confirmMail.text, /Reply YES/)

  // "Yes" by email files it: the deposit is matched to a posted entry in Service revenue, and the rule is learned.
  await h.email(reply('owner@example.test', box, confirmMail.subject, 'Yes'), { from: 'owner@example.test', to: box })
  view = await h.view('questions')
  q = at(view.settled, x => x.id === stripe.id)
  assert.deepEqual([q.status, q.answered_via, q.answered_by, q.result_kind], ['filed', 'email', 'owner@example.test', 'match'])
  assert.equal(await entries(), posted + 1)
  const line = at((await h.view('bank/lines')).lines, l => l.description.includes('STRIPE TRANSFER'))
  assert.deepEqual(line.filed_to, ['Service revenue'])
  const rule = at((await h.view('bank/rules')).rules, r => r.id === q.rule_id)
  assert.equal(rule.payee, 'Stripe')
  const tb = await h.view('reports/trial-balance?to=2026-10-31')
  assert.equal(tb.balanced, true)

  // Learned: the next Stripe payout files itself by the rule; nobody is asked about it.
  await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'operating-checking-2026-10b.csv', content: 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nCREDIT,10/13/2026,"STRIPE TRANSFER ST-Q4M1",980.00,ACH_CREDIT,29865.64,\n', opening: '28885.64', closing: '29865.64', start: '2026-10-09', end: '2026-10-15', confirmLast4: '4821' })
  assert.equal(at((await h.view('bank/lines')).lines, l => l.description.includes('ST-Q4M1')).rule_id, rule.id)
  await h.command('books-agent.run', {})
  assert.ok(!(await h.view('questions')).open.some(x => x.facts['The bank says']?.includes('ST-Q4M1')))

  // In the app: a chosen answer files it without a rule unless asked; a receipt question takes the file.
  const adobe = at((await h.view('questions')).open, x => x.kind === 'unfiled' && x.record_date === '2026-10-02')
  const filed = await h.command('question.answer', { id: adobe.id, accountId: s.acct['6200'] })
  assert.equal(filed.question.status, 'filed')
  assert.equal(filed.question.rule_id, null)
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
