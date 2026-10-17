import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { at, books, harness } from './harness.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')

/** The model's network edge: answers as Anthropic's Messages API does, and records what it was sent. */
function fakeModel(answers) {
  const seen = []
  const model = async request => {
    const body = await request.json()
    seen.push({ headers: Object.fromEntries(request.headers), body })
    const content = body.messages[0].content, file = content.find(p => p.type !== 'text')
    const answer = answers(file, content.at(-1).text)
    return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn' })
  }
  return { model, seen }
}

async function capture(h, bytes, { type = 'image/jpeg', name = 'IMG_2041.jpg', source = 'camera', cookie = h.owner, status = 200, ...fields } = {}) {
  const form = new FormData()
  form.set('file', new Blob([bytes], { type }), name)
  form.set('source', source)
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  const r = await fetch(`${h.origin}/api/pantry/receipts/capture`, { method: 'POST', headers: { origin: h.origin, cookie }, body: form })
  const value = await r.json()
  assert.equal(r.status, status, JSON.stringify(value))
  return value
}

/** A card statement with one hardware-store charge and one unexplained charge, not yet in the books. */
async function cardWithCharges(h, acct) {
  const card = await h.command('bank-account.save', { name: 'Business checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4417', routing: '', openingDate: '2026-08-31', openingBalance: '5000.00' })
  const csv = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,09/15/2026,"POS DEBIT THE HOME DEPOT #6512 ATLANTA GA",-84.37,DEBIT_CARD,4915.63,\nDEBIT,09/22/2026,"POS DEBIT CORNER CAFE",-23.10,DEBIT_CARD,4892.53,\n'
  const st = await h.command('statement.import', { bankAccountId: card.id, fileName: 'checking-2026-09.csv', content: csv, opening: '5000.00', closing: '4892.53', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4417' })
  const lines = (await h.view(`reconciliation/${st.statement.id}`)).lines
  return { card, st, depot: at(lines, l => l.description.includes('HOME DEPOT')), cafe: at(lines, l => l.description.includes('CORNER CAFE')) }
}

test('Receipts: a phone photo is kept byte for byte, read by the install\'s own model, and attached to its card charge only when a person accepts', async t => {
  const { model, seen } = fakeModel(file => {
    assert.equal(file.type, 'image')
    return { receipt: true, vendor: 'The Home Depot', date: '2026-09-14', total: '84.37', tax: '6.12', currency: 'USD', category: '6300', note: '' }
  })
  const h = await harness({ outbound: model }); t.after(() => h.close())
  const { acct } = await books(h)
  const { depot, cafe } = await cardWithCharges(h, acct)
  const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1_400_000)])

  // No key: the photo is kept and says so; nothing is guessed.
  const first = await capture(h, photo)
  let view = await h.view('receipts')
  let r = at(view.review, x => x.id === first.id)
  assert.equal(r.read_status, 'no-key'); assert.equal(r.read_note, 'Add a key to read receipts.')
  assert.equal(r.read_vendor, null); assert.equal(r.read_total_cents, null); assert.deepEqual(r.candidates, [])
  assert.equal(seen.length, 0)
  // Typing the details from the receipt finds its charge without a key; with no transaction chosen, accepting says what is missing.
  const typed = await h.view(`receipts/candidates?${new URLSearchParams({ vendor: 'The Home Depot', date: '2026-09-14', total: '84.37', currency: '' })}`)
  assert.equal(typed.candidates[0].id, depot.id); assert.ok(!typed.candidates.some(c => c.id === cafe.id))
  const refused = await h.command('receipt.attach', { id: r.id, revision: r.revision, total: '84.37' }, h.owner, 400)
  assert.match(refused.error, /Choose the transaction/)
  await h.command('receipt.dismiss', { id: r.id, revision: r.revision })

  // The owner adds the install's key on the page; it is never shown again.
  const bea = await h.member('bea@example.test', 'bookkeeper')
  await h.command('reader.save', { provider: 'anthropic', model: 'claude-sonnet-5-5', key: 'sk-ant-test-key-7f3a', workspace: 'wrkspc_test' }, bea, 403)
  const saved = await h.command('reader.save', { provider: 'anthropic', model: 'claude-sonnet-5-5', key: 'sk-ant-test-key-7f3a', workspace: 'wrkspc_test' })
  assert.equal(saved.saved.key_hint, '…7f3a'); assert.ok(!JSON.stringify(saved).includes('sk-ant-test-key'))
  const stored = await h.db.prepare('SELECT key_sealed FROM pt_reader').first()
  assert.ok(!stored.key_sealed.includes('sk-ant-test-key'), 'the key is sealed at rest')

  // A bookkeeper photographs the receipt; the model reads it with the install's key.
  const { id } = await capture(h, photo, { cookie: bea })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].headers['x-api-key'], 'sk-ant-test-key-7f3a'); assert.equal(seen[0].headers['anthropic-workspace-id'], 'wrkspc_test')
  assert.equal(Buffer.from(seen[0].body.messages[0].content[0].source.data, 'base64').equals(photo), true, 'the model reads the photo as taken')
  view = await h.view('receipts', bea)
  r = at(view.review, x => x.id === id)
  assert.deepEqual([r.read_status, r.read_vendor, r.read_date, r.read_total_cents, r.read_tax_cents, r.read_currency], ['read', 'The Home Depot', '2026-09-14', 8437, 612, 'USD'])
  assert.equal(r.read_account_id, acct['6300'])
  // It proposes the matching charge by amount, date window and vendor; the café charge is not offered.
  assert.equal(r.candidates[0].kind, 'bankline'); assert.equal(r.candidates[0].id, depot.id); assert.equal(r.candidates[0].record, true)
  assert.ok(!r.candidates.some(c => c.id === cafe.id))
  // Nothing has moved in the books before a person accepts.
  const posted = async () => Number((await h.db.prepare("SELECT COUNT(*) AS n FROM pt_journal_entries WHERE status = 'posted'").first()).n)
  const before = await posted()
  assert.equal((await h.db.prepare('SELECT linked_kind FROM pt_documents WHERE id = ?').bind(r.document_id).first()).linked_kind, null)

  // The person corrects the tax and accepts: the charge is recorded to Office supplies, matched, and keeps its receipt.
  const attached = await h.command('receipt.attach', { id: r.id, revision: r.revision, targetKind: 'bankline', targetId: depot.id, vendor: 'The Home Depot', date: '2026-09-14', total: '84.37', tax: '6.21', currency: 'USD', accountId: acct['6300'] }, bea)
  assert.equal(attached.status, 'attached'); assert.equal(attached.linked_kind, 'journal'); assert.equal(attached.tax_cents, 621); assert.equal(attached.read_tax_cents, 612)
  assert.equal(await posted(), before + 1)
  const entry = await h.db.prepare('SELECT e.memo, l.debit_cents FROM pt_journal_entries e JOIN pt_journal_lines l ON l.entry_id = e.id WHERE e.id = ? AND l.account_id = ?').bind(attached.linked_id, acct['6300']).first()
  assert.deepEqual([entry.memo, entry.debit_cents], ['The Home Depot', 8437])
  const audit = await h.db.prepare("SELECT detail FROM pt_audit WHERE action = 'receipt.attach' AND subject_id = ?").bind(r.id).first()
  assert.deepEqual(JSON.parse(audit.detail).corrected, ['tax'])
  // The original comes back byte for byte, with its fingerprint.
  const doc = await fetch(`${h.origin}/api/pantry/documents/${r.document_id}`, { headers: { cookie: bea } })
  const bytes = Buffer.from(await doc.arrayBuffer())
  assert.ok(bytes.equals(photo)); assert.equal(r.sha256, sha(photo))

  // At close the unexplained café charge is listed with "add receipt"; the Home Depot charge is not.
  await h.command('match.approve', { bankLineIds: [cafe.id], create: [{ type: 'fee', amount: '23.10', accountId: acct['6500'], direction: 'out', memo: 'Corner Cafe' }] })
  let close = await h.view('close/2026-09')
  assert.deepEqual(close.receipts.missing.map(m => m.amount_cents), [2310])
  const cafeEntry = close.receipts.missing[0].id
  // Adding a receipt to that entry straight from the close list attaches it there.
  const added = await capture(h, Buffer.from('%PDF-1.4 Corner Cafe 23.10'), { type: 'application/pdf', name: 'cafe.pdf', source: 'upload', targetKind: 'journal', targetId: cafeEntry })
  close = await h.view('close/2026-09')
  assert.deepEqual(close.receipts.missing, [])
  assert.equal((await h.db.prepare('SELECT linked_id FROM pt_receipts WHERE id = ?').bind(added.id).first()).linked_id, cafeEntry)

  // The export carries every entry's receipt with its fingerprint.
  const csv = await (await fetch(`${h.origin}/api/pantry/package/2026-09/general-ledger.csv`, { headers: { cookie: h.owner } })).text()
  assert.match(csv, new RegExp(`IMG_2041\\.jpg sha256:${sha(photo)} /api/pantry/documents/${r.document_id}`))
})

const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% Brightline Software invoice BL-3391, 2026-09-08, total $640.00\n%%EOF\n')
function email({ to, from = 'billing@brightline.example', subject = 'Your Brightline receipt', attachment = pdf }) {
  const b = 'pantry-test-boundary'
  return Buffer.from([`From: Brightline Billing <${from}>`, `To: ${to}`, `Subject: ${subject}`, 'Message-ID: <r-1@brightline.example>', 'Date: Tue, 08 Sep 2026 10:00:00 +0000', 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`, '', `--${b}`, 'Content-Type: text/plain; charset=utf-8', '', 'Thanks for your payment. Your receipt is attached.', '',
    `--${b}`, 'Content-Type: application/pdf; name="BL-3391.pdf"', 'Content-Disposition: attachment; filename="BL-3391.pdf"', 'Content-Transfer-Encoding: base64', '', attachment.toString('base64').replace(/.{76}/g, '$&\r\n'), `--${b}--`, ''].join('\r\n'))
}
// The envelope sender is the provider's bounce address, as with real mail; the message's From is the vendor.
const deliver = (h, to, raw) => fetch(`${h.origin}/cdn-cgi/local/email?from=bounces%2B42%40em.brightline.example&to=${encodeURIComponent(to)}`, { method: 'POST', body: raw })

test('Receipts: an email forwarded to the private Pantry address is kept whole, read from its PDF, and a rule the owner set attaches it', async t => {
  const { model, seen } = fakeModel(file => {
    assert.equal(file.type, 'document')
    return { receipt: true, vendor: 'Brightline Software', date: '2026-09-08', total: '640.00', tax: null, currency: 'USD', category: '6200', note: '' }
  })
  const h = await harness({ outbound: model }); t.after(() => h.close())
  const { acct } = await books(h)
  await h.command('reader.save', { provider: 'anthropic', key: 'sk-ant-test-key-1111', workspace: '' })
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', routing: '', openingDate: '2026-08-31', openingBalance: '2000.00' })
  await h.command('statement.import', { bankAccountId: bank.id, fileName: 'sep.csv', content: 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,09/09/2026,"BRIGHTLINE SOFTWARE ACH PMT",-640.00,ACH_DEBIT,1360.00,\n', opening: '2000.00', closing: '1360.00', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })

  // The owner enters the mailbox routed to Pantry; Pantry adds a private tag.
  const settings = await h.command('receipt-address.create', { mailbox: 'receipts@books.example.test' })
  assert.match(settings.address, /^receipts\+[a-z2-9]{16}@books\.example\.test$/)
  await h.command('receipt-rule.save', { vendor: 'Brightline', accountId: acct['6200'], max: '1000.00' })

  // Mail to the untagged mailbox is refused and nothing is kept.
  await deliver(h, 'receipts@books.example.test', email({ to: 'receipts@books.example.test' }))
  assert.equal(Number((await h.db.prepare('SELECT COUNT(*) AS n FROM pt_receipts').first()).n), 0)

  // Mail to the Pantry address (here its dash spelling, for a domain without Subaddressing): the whole
  // message is kept, its PDF read, and the rule attaches and records it.
  assert.equal(settings.exactAddress, settings.address.replace('+', '-'))
  const raw = email({ to: settings.exactAddress })
  await deliver(h, settings.exactAddress, raw)
  const r = await h.db.prepare('SELECT * FROM pt_receipts').first()
  assert.ok(r, 'the forwarded receipt was received')
  assert.deepEqual([r.source, r.sender, r.subject, r.read_status], ['email', 'billing@brightline.example', 'Your Brightline receipt', 'read'])
  assert.equal(seen.length, 1); assert.ok(Buffer.from(seen[0].body.messages[0].content[0].source.data, 'base64').equals(pdf), 'the model read the attached PDF')
  const original = await fetch(`${h.origin}/api/pantry/documents/${r.document_id}`, { headers: { cookie: h.owner } })
  assert.ok(Buffer.from(await original.arrayBuffer()).equals(raw), 'the email is kept as delivered')
  const attachment = await fetch(`${h.origin}/api/pantry/documents/${r.file_document_id}`, { headers: { cookie: h.owner } })
  assert.ok(Buffer.from(await attachment.arrayBuffer()).equals(pdf))
  assert.equal(r.status, 'attached'); assert.ok(r.rule_id); assert.equal(r.target_kind, 'bankline')
  const entry = await h.db.prepare('SELECT l.debit_cents FROM pt_journal_lines l WHERE l.entry_id = ? AND l.account_id = ?').bind(r.linked_id, acct['6200']).first()
  assert.equal(entry.debit_cents, 64000)
  const audit = await h.db.prepare("SELECT actor_email, detail FROM pt_audit WHERE action = 'receipt.attach-by-rule'").first()
  assert.equal(audit.actor_email, 'owner@example.test'); assert.equal(JSON.parse(audit.detail).vendor, 'Brightline')
  const view = await h.view('receipts')
  assert.equal(at(view.attached, x => x.id === r.id).linked_label.includes('Brightline Software'), true)
  assert.equal(view.inbox.address, settings.address); assert.ok(view.inbox.lastReceivedAt)
})
