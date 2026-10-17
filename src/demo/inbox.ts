// What came in and what Pantry asked, through its own code: two receipts
// received (the Home Depot photo attached by the owner's receipt rule, the
// Paper & Pine PDF the supplier emailed, waiting for a person), then one pass of the books agent,
// two of whose questions the owner answered in Pantry: Brightline's invoice for
// its receipt, and words about the unexplained savings transfer. The model's readings, of the receipts and of the owner's words, are
// seeded as the model would return them, because the demo calls no provider;
// filing still waits for the owner's yes.
import type { Bindings } from '../auth.server'
import { longDay } from '../pantry/core'
import { invoicePdf } from '../pantry/invoice-pdf'
import { one, q, run } from '../pantry/db'
import { answer, awaitYes, ownerByEmail } from '../pantry/questions/answer'
import { runAgent } from '../pantry/questions/run'
import { parse } from '../pantry/questions/store'
import { receive } from '../pantry/receipts/intake'
import { DEFAULTS, type Reading } from '../pantry/receipts/reader'
import { PURPOSE } from '../pantry/receipts/settings'
import { seal } from '../pantry/seal'
import { applyRules as attachByRule } from '../pantry/receipts/review'
import { demoId as id } from './records'
import { receiptPhoto } from './receipt-photo'

type Seed = { env: Bindings; ownerEmail: string; now: Date; suppliesBillDay: string }

const read = (reading: Reading, note: string) => ({ status: 'read' as const, note, model: DEFAULTS.anthropic.model, reading })

/** The install's AI reading, connected like the demo's other providers: sealed, with no working key, so nothing reaches a provider. Seeded last, after the readings it made. */
export async function connectReader({ env, ownerEmail, now }: Seed) {
  await run(env.DB, [q("INSERT INTO pt_reader (id, provider, endpoint, model, workspace, key_sealed, key_hint, updated_by, updated_at, revision) VALUES (1, 'anthropic', ?, ?, '', ?, '…demo', ?, ?, ?) ON CONFLICT DO NOTHING",
    DEFAULTS.anthropic.endpoint, DEFAULTS.anthropic.model, await seal(env.SESSION_SECRET, PURPOSE, 'demo-connection-with-no-provider-key'), ownerEmail, now.toISOString(), id('reader'))])
}

export async function receiveReceipts({ env, ownerEmail, now, suppliesBillDay }: Seed) {
  const db = env.DB, by = { email: ownerEmail, kind: 'person' as const }
  if (await one(db, 'SELECT 1 FROM pt_receipts LIMIT 1')) return
  const depot = (await one(db, 'SELECT posted_date FROM pt_bank_lines WHERE id = ?', id('feed-line-depot')))!.posted_date
  await run(db, [q('INSERT INTO pt_receipt_rules (id, vendor, account_id, max_cents, active, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)', id('receipt-rule-depot'), 'Home Depot', id('6300'), 50000, ownerEmail, now.toISOString())])
  const photo = await receive(db, env, { by, source: 'camera', read: '',
    original: { name: 'home-depot-receipt.png', mediaType: 'image/png', bytes: await receiptPhoto(depot) } },
    read({ receipt: true, vendor: 'Home Depot', date: depot, total: 31248, tax: 2112, currency: 'USD', category: '6300', note: '' }, 'Vendor, date, total and tax read from the photo.'))
  await attachByRule(db, photo.id)
  await receive(db, env, { by, source: 'email', sender: 'receipts@paperandpine.example', subject: 'Your Paper & Pine receipt PP-204', read: '',
    original: { name: 'paper-and-pine-PP-204.pdf', mediaType: 'application/pdf', bytes: invoicePdf({ business: 'Paper & Pine Supply', title: 'Receipt PP-204', facts: [['Date', longDay(suppliesBillDay)], ['Paid', 'On account']],
      lines: [{ description: 'Workshop paper, 40 sheets', quantity: '1', amount: '$148.00' }, { description: 'Markers and tape', quantity: '1', amount: '$25.00' }], totals: [['Sales tax', '$13.50'], ['Total', '$186.50']], notes: ['Thank you for your order.'] }) } },
    read({ receipt: true, vendor: 'Paper & Pine Supply', date: suppliesBillDay, total: 18650, tax: 1350, currency: 'USD', category: '6300', note: '' }, 'Vendor, date, total and tax read from the email.'))
}

/** One pass of the books agent; the owner's answers: Brightline's invoice for its receipt question, and words about the transfer, read and waiting for a yes. */
export async function askQuestions({ env, ownerEmail }: Seed) {
  const db = env.DB, owner = { ...ownerByEmail(ownerEmail), via: 'app' as const }
  await runAgent(env)
  const software = await one(db, "SELECT id FROM pt_questions WHERE fingerprint = ? AND status = 'open'", `receipt:bill:${id('software')}`)
  if (software) await answer(env, db, software.id, { document: { name: 'brightline-INV-88.pdf', mediaType: 'application/pdf', bytes: invoicePdf({ business: 'Brightline Software', title: 'Invoice INV-88', facts: [['Paid', 'By bank transfer']],
    lines: [{ description: 'Team plan, 4 seats', quantity: '1', amount: '$640.00' }], totals: [['Total', '$640.00']], notes: [] }) }, note: 'Their invoice for the month' }, owner)
  const row = await one(db, "SELECT * FROM pt_questions WHERE fingerprint = ? AND status = 'open'", `unfiled:${id('feed-line-transfer')}`)
  if (!row) return
  await awaitYes(db, parse(row), "That was Dana Ruiz's deposit for the lookbook shoot. I paid her from savings.",
    { choice: null, accountId: id('6000'), remember: false, note: '' }, owner)
}
