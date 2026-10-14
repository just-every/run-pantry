// The QuickBooks Online move-in kit on Base's import kit: dry-run preview,
// reviewed commit into staged native records, accountant sign-off that posts
// the opening balances, and undo while nothing has been posted.
import { applyD1ImportBatches, createD1ImportJob, planD1Import, undoD1Import, type D1ImportContext } from '../../modules/import-kit/src/d1/index'
import { authority, authorityCondition, who, type Actor, type Need } from '../access'
import { now, requireThat, text, uid, Fault, usd, type Data } from '../core'
import { all, approval, audit, changed, one, q, run } from '../db'
import { ageing } from '../reports'
import { requireEntity } from '../settings'
import { NAMESPACE, LABELS, bundle, checks, mapping, readPackage, records } from './plan'
import { targets } from './target'
import type { Command, Context } from '../context'

const PRINCIPAL = 'pantry:move-in'

function context(c: Context, version: string, need: Need): D1ImportContext {
  return { destination: 'books', namespace: NAMESPACE, mappingVersion: version, storage: { database: c.db, targets }, batchSize: 50, maxBatches: 40,
    authorization: { principalId: PRINCIPAL, predicate: () => authorityCondition(c.actor as Actor, need) as any } }
}

async function emptyBooks(db: D1Database) {
  const used = await one(db, "SELECT (SELECT COUNT(*) FROM pt_accounts) + (SELECT COUNT(*) FROM pt_contacts) + (SELECT COUNT(*) FROM pt_journal_entries) AS n")
  return Number(used?.n) === 0
}

async function prepare(c: Context, b: Data) {
  await requireEntity(c.db)
  const p = readPackage(b), r = records(p), list = checks(r)
  const plan = await planD1Import(bundle(p, r.list), mapping(p, r, c.actor.email), context(c, `qbo-cutover-v1:${r.cutoverDate}`, 'record'))
  const by = (kind: string) => ({ accepted: plan.entries.filter(e => e.source.kind === kind && !e.rejection).length, refused: plan.entries.filter(e => e.source.kind === kind && e.rejection).length })
  const refused = plan.entries.filter(e => e.rejection).map(e => ({ kind: e.source.kind, file: (e.source.location as any).artifact, row: (e.source.location as any).row, reason: e.rejection, sourceId: e.source.sourceId }))
  const openItems = r.list.filter(x => (x.kind === 'invoice' || x.kind === 'bill') && !x.payload.refused).length
  const empty = await emptyBooks(c.db)
  return { plan, preview: {
    cutoverDate: r.cutoverDate, fingerprint: plan.fingerprint,
    counts: { accounts: by('account'), customers: by('customer'), vendors: by('vendor'), bankAccounts: by('bank'), trialBalance: { accepted: r.tbRows.length, refused: by('trial-balance').refused }, openInvoices: by('invoice'), unpaidBills: by('bill'), historyLines: by('history') },
    checks: [...list, { key: 'empty', title: 'Books are empty before move-in', ok: empty, detail: empty ? 'No accounts, contacts or entries yet' : 'Move-in starts from empty books; this installation already has records' }],
    refused,
    missingDocuments: `QuickBooks Online exports attachments separately and this import does not read them: ${openItems} open invoices and bills will have no source document in Pantry until you upload them.`,
    files: Object.fromEntries(Object.entries(p.files).map(([k, f]) => [k, { label: LABELS[k as keyof typeof LABELS], name: f.name, bytes: new TextEncoder().encode(f.content).length }])),
  } }
}

const preview: Command = { need: 'record', async run(c, b) { return (await prepare(c, b)).preview } }

const commit: Command = { need: 'record', async run(c, b) {
  const { plan, preview } = await prepare(c, b)
  const failing = preview.checks.filter(x => !x.ok)
  requireThat(!failing.length, `Resolve before importing: ${failing.map(x => x.title).join('; ')}`, 409)
  requireThat(!preview.refused.length, `${preview.refused.length} rows were refused; correct the export and preview again`, 409)
  requireThat(b.fingerprint === plan.fingerprint, 'The files or bank details changed since your preview; review the preview again', 409)
  const prior = await one(c.db, "SELECT COUNT(*) AS n FROM ik_jobs WHERE destination = 'books' AND namespace = ? AND fingerprint = ? AND state IN ('undone', 'rolled_back')", NAMESPACE, plan.fingerprint)
  const ctx = { ...context(c, plan.mappingVersion, 'record'), reviewedFingerprint: plan.fingerprint, operationKey: `${plan.fingerprint}:${Number(prior?.n ?? 0)}` }
  const job = await applyD1ImportBatches(await createD1ImportJob(plan, ctx), ctx)
  requireThat(job.state === 'completed', `Import stopped in state ${job.state}: ${job.error ?? ''}`, 409)
  await run(c.db, [authority(c.actor, 'record'), audit(who(c.actor), 'move-in.import', 'import', job.id, { fingerprint: plan.fingerprint, records: job.total, cutoverDate: preview.cutoverDate })])
  return { job, preview }
} }

/** The accountant's sign-off posts the opening entry once the staged records still tie out. */
const accept: Command = { need: 'post', async run(c, b) {
  const cut = await one(c.db, 'SELECT * FROM pt_cutovers WHERE id = ?', text(b.id, 'Cutover'))
  requireThat(cut, 'Cutover not found', 404)
  requireThat(cut.status === 'staged' && cut.revision === b.revision, 'This cutover changed or is already accepted', 409)
  const entry = (await one(c.db, 'SELECT * FROM pt_journal_entries WHERE id = ?', cut.opening_entry_id))!
  // A second person posts the opening balances (PAN-02): never the one who imported them, unless the owner.
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || entry.prepared_by !== c.actor.email), 'Someone other than the importer signs off the opening balances', 403)
  const lines = await all(c.db, 'SELECT l.*, a.subtype FROM pt_journal_lines l JOIN pt_accounts a ON a.id = l.account_id WHERE l.entry_id = ?', entry.id)
  const net = (subtype: string) => lines.filter(l => l.subtype === subtype).reduce((s, l) => s + l.debit_cents - l.credit_cents, 0)
  const ar = await ageing(c.db, 'receivable', cut.cutover_date), ap = await ageing(c.db, 'payable', cut.cutover_date)
  requireThat(ar.itemsTotal === net('receivable'), `Open invoices ${usd(ar.itemsTotal)} no longer equal opening receivables ${usd(net('receivable'))}`, 409)
  requireThat(ap.itemsTotal === -net('payable'), `Unpaid bills ${usd(ap.itemsTotal)} no longer equal opening payables ${usd(-net('payable'))}`, 409)
  for (const bank of await all(c.db, 'SELECT * FROM pt_bank_accounts')) requireThat(lines.filter(l => l.account_id === bank.account_id).reduce((s, l) => s + l.debit_cents - l.credit_cents, 0) === bank.opening_cents, `${bank.name}'s opening balance no longer equals its statement balance`, 409)
  await run(c.db, [authority(c.actor, 'post'),
    approval(who(c.actor), 'cutover', cut.id, cut.revision, 'accept', 'approved', 'Accountant sign-off of trial balance, open items and bank balances'),
    q("UPDATE pt_journal_entries SET status = 'posted', number = (SELECT COALESCE(MAX(number), 0) + 1 FROM pt_journal_entries), posted_by = ?, posted_at = ?, revision = ? WHERE id = ? AND status = 'draft' AND revision = ?", c.actor.email, now(), uid(), entry.id, entry.revision), changed(),
    q("UPDATE pt_cutovers SET status = 'accepted', accepted_by = ?, accepted_at = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'staged'", c.actor.email, now(), uid(), cut.id, cut.revision), changed(),
    audit(who(c.actor), 'move-in.accept', 'cutover', cut.id, { openingEntry: entry.id })])
  return moveInView(c)
} }

/** Undo removes everything the import created, only while nothing it staged has changed. */
const undo: Command = { need: 'post', async run(c, b) {
  const job = await one(c.db, "SELECT * FROM ik_jobs WHERE id = ? AND destination = 'books' AND namespace = ?", text(b.jobId, 'Import'), NAMESPACE)
  requireThat(job && job.state === 'completed', 'Only a completed import is undone', 409)
  const accepted = await one(c.db, "SELECT 1 FROM pt_cutovers WHERE status = 'accepted'")
  requireThat(!accepted, 'The opening balances are posted; correct them with a reversal or adjusting entry instead of undoing the import', 409)
  try {
    const result = await undoD1Import(job.id, context(c, job.mapping_version, 'post'))
    await run(c.db, [authority(c.actor, 'post'), audit(who(c.actor), 'move-in.undo', 'import', job.id, { state: result.state })])
    return { job: result }
  } catch (e) {
    const message = String((e as Error).message)
    if (message.includes('FOREIGN KEY')) throw new Fault(409, 'Records entered after the import still use imported accounts or contacts; undo is no longer possible')
    if (message.includes('NATIVE_EDIT_CONFLICT')) throw new Fault(409, 'An imported record has changed since the import; undo would lose that work')
    throw e
  }
} }

export const moveInCommands: Record<string, Command> = {
  'move-in.preview': preview,
  'move-in.commit': commit,
  'move-in.accept': accept,
  'move-in.undo': undo,
}

export async function moveInView(c: Context) {
  const jobs = await all(c.db, "SELECT id, state, checkpoint, total, fingerprint, mapping_version, error FROM ik_jobs WHERE destination = 'books' AND namespace = ? ORDER BY rowid DESC", NAMESPACE)
  return { jobs, cutovers: await all(c.db, 'SELECT * FROM pt_cutovers ORDER BY cutover_date DESC, id'), history: Number((await one(c.db, 'SELECT COUNT(*) AS n FROM pt_history_lines'))?.n ?? 0) }
}
