// What came in and what Pantry asked, through its own code: two receipts
// received (the Home Depot photo attached by the owner's receipt rule, the
// Paper & Pine email waiting for a person), then one pass of the books agent,
// two of whose questions the owner answered in Pantry: Brightline's invoice for
// its receipt, and words about the unexplained savings transfer. The model's readings, of the receipts and of the owner's words, are
// seeded as the model would return them, because the demo calls no provider;
// filing still waits for the owner's yes.
import type { Bindings } from '../auth.server'
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

type Seed = { env: Bindings; ownerEmail: string; now: Date; suppliesBillDay: string }

const text = (s: string) => new TextEncoder().encode(s)
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
    original: { name: 'home-depot-receipt.txt', mediaType: 'text/plain', bytes: text(`THE HOME DEPOT #6512\n1234 El Camino Real, San Bruno, CA 94066\n${depot} 14:27\n2X4-8FT STUD      6.48\nDEWALT DRILL    299.00\nSUBTOTAL        305.48\nSALES TAX         7.00\nTOTAL           312.48\nAMEX **** 1009\n`) } },
    read({ receipt: true, vendor: 'Home Depot', date: depot, total: 31248, tax: 700, currency: 'USD', category: '6300', note: '' }, 'Vendor, date, total and tax read from the photo.'))
  await attachByRule(db, photo.id)
  await receive(db, env, { by, source: 'email', sender: 'receipts@paperandpine.example', subject: 'Your Paper & Pine receipt PP-204', read: '',
    original: { name: 'paper-and-pine-PP-204.txt', mediaType: 'text/plain', bytes: text(`Paper & Pine Supply\nReceipt PP-204 · ${suppliesBillDay}\nWorkshop paper, 40 sheets   148.00\nMarkers and tape              25.00\nSales tax                     13.50\nTotal                        186.50\nPaid on account\n`) } },
    read({ receipt: true, vendor: 'Paper & Pine Supply', date: suppliesBillDay, total: 18650, tax: 1350, currency: 'USD', category: '6300', note: '' }, 'Vendor, date, total and tax read from the email.'))
}

/** One pass of the books agent; the owner's answers: Brightline's invoice for its receipt question, and words about the transfer, read and waiting for a yes. */
export async function askQuestions({ env, ownerEmail }: Seed) {
  const db = env.DB, owner = { ...ownerByEmail(ownerEmail), via: 'app' as const }
  await runAgent(env)
  const software = await one(db, "SELECT id FROM pt_questions WHERE fingerprint = ? AND status = 'open'", `receipt:bill:${id('software')}`)
  if (software) await answer(env, db, software.id, { document: { name: 'brightline-INV-88.txt', mediaType: 'text/plain', bytes: text('Brightline Software\nInvoice INV-88\nTeam plan, 4 seats: $640.00\nPaid by bank transfer\n') }, note: 'Their invoice for the month' }, owner)
  const row = await one(db, "SELECT * FROM pt_questions WHERE fingerprint = ? AND status = 'open'", `unfiled:${id('feed-line-transfer')}`)
  if (!row) return
  await awaitYes(db, parse(row), "That was Dana Ruiz's deposit for the lookbook shoot. I paid her from savings.",
    { choice: null, accountId: id('6000'), remember: false, note: '' }, owner)
}
