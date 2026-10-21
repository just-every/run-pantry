// The report and spreadsheet move-in sources on Base's import kit: dry-run
// preview, reviewed commit into staged native records, accountant sign-off that
// posts the opening balances, and undo while nothing has been posted.
import { applyD1ImportBatches, createD1ImportJob, planD1Import, undoD1Import, type D1ImportContext } from '../../modules/import-kit/src/d1/index'
import { authority, authorityCondition, who, type Actor, type Need } from '../access'
import { now, requireThat, text, uid, Fault, usd, type Data } from '../core'
import { all, approval, audit, changed, guard, one, q, run } from '../db'
import { ageing } from '../reports'
import { requireEntity } from '../settings'
import { bundle, checks, mapping, mappingVersion, readPackage } from './plan'
import { quickbooks } from './qbo'
import { targetsFor } from './target'
import { xero } from './xero'
import { xeroAvailability } from './xero-api'
import { forgetCarried, xeroCommands, xeroView } from './xero-attachments'
import type { Source } from './source'
import { spreadsheets, type SpreadsheetPackage } from './spreadsheet'
import { readSpreadsheets, savedSpreadsheetMappings, spreadsheetCommands } from './spreadsheet-storage'
import { spreadsheetMapping } from './spreadsheet-mapping'
import type { Command, Context } from '../context'

const PRINCIPAL = 'pantry:move-in'
const SOURCES: Record<string, Source> = { [quickbooks.key]: quickbooks, [xero.key]: xero, [spreadsheets.key]: spreadsheets }
const byNamespace = (namespace: string) => Object.values(SOURCES).find(s => s.namespace === namespace)!
const NAMESPACES = Object.values(SOURCES).map(s => s.namespace)

/** `source` names the kit; QuickBooks Online, the first kit, when a caller sends none. */
function sourceOf(b: Data) {
  const s = SOURCES[b.source ?? quickbooks.key]
  requireThat(s, 'Choose QuickBooks Online, Xero or Spreadsheet')
  return s
}

function context(c: Context, source: Source, version: string, need: Need): D1ImportContext {
  return { destination: 'books', namespace: source.namespace, mappingVersion: version, storage: { database: c.db, targets: targetsFor(source.prefix) }, ...(source === spreadsheets ? { batchSize: 10, maxBatches: 1, maxBatchBytes: 8 * 1024 * 1024 } : { batchSize: 50, maxBatches: 40 }),
    authorization: { principalId: PRINCIPAL, predicate: action => { const allowed = authorityCondition(c.actor as Actor, need); return source === spreadsheets && action !== 'plan' && action !== 'read' ? { sql: `(${allowed.sql}) AND NOT EXISTS (SELECT 1 FROM pt_journal_entries WHERE status = 'posted') AND NOT EXISTS (SELECT 1 FROM pt_cutovers WHERE status = 'accepted')`, params: allowed.params } : allowed as any } } }
}

async function emptyBooks(db: D1Database) {
  const used = await one(db, "SELECT (SELECT COUNT(*) FROM pt_accounts) + (SELECT COUNT(*) FROM pt_contacts) + (SELECT COUNT(*) FROM pt_journal_entries) AS n")
  return Number(used?.n) === 0
}

async function prepare(c: Context, b: Data) {
  await requireEntity(c.db)
  const source = sourceOf(b), p = source === spreadsheets ? await readSpreadsheets(c, b) : readPackage(source, b), r = source.parse(p), list = r.listOnly ? [] : checks(r)
  const plan = await planD1Import(bundle(source, p, r.list), (source === spreadsheets ? spreadsheetMapping(r, c.actor.email) : mapping(source, r, c.actor.email)), context(c, source, mappingVersion(source, r.cutoverDate), 'record'))
  const by = (kind: string) => ({ accepted: plan.entries.filter(e => e.source.kind === kind && !e.rejection).length, refused: plan.entries.filter(e => e.source.kind === kind && e.rejection).length })
  const refused = plan.entries.filter(e => e.rejection).map(e => ({ kind: e.source.kind, file: (e.source.location as any).artifact, row: (e.source.location as any).row, reason: e.rejection, sourceId: e.source.sourceId }))
  const openItems = r.list.filter(x => (x.kind === 'invoice' || x.kind === 'bill') && !x.payload.refused).length
  const empty = await emptyBooks(c.db)
  const spreadsheetReady = source === spreadsheets && !await one(c.db, "SELECT 1 FROM pt_journal_entries WHERE source_kind <> 'opening' OR status = 'posted'") && !await one(c.db, "SELECT 1 FROM pt_cutovers WHERE source <> 'spreadsheet' OR cutover_date <> ?", r.cutoverDate)
  const attachments = source === xero ? xeroAvailability(c.env) : null
  return { plan, source, preview: {
    source: source.key, cutoverDate: r.cutoverDate, fingerprint: plan.fingerprint,
    counts: { accounts: by('account'), customers: by('customer'), vendors: by('vendor'), ...(source === spreadsheets ? { items: by('item') } : {}), bankAccounts: by('bank'), trialBalance: { accepted: r.tbRows.length, refused: by('trial-balance').refused }, openInvoices: by('invoice'), unpaidBills: by('bill'), historyLines: by('history') },
    checks: [...list, source === spreadsheets ? { key: 'staged', title: 'Opening balances can still be staged', ok: spreadsheetReady, detail: spreadsheetReady ? 'New lists or updates to staged spreadsheet records; no posted entries' : 'Opening balances are already posted, another source owns the cutover, or its date differs' } : { key: 'empty', title: 'Books are empty before move-in', ok: empty, detail: empty ? 'No accounts, contacts or entries yet' : 'Move-in starts from empty books; this installation already has records' }],
    ...(source === spreadsheets ? { mappings: (p as SpreadsheetPackage).spreadsheet.mappings, rows: plan.entries.filter(e => e.source.kind !== 'cutover' && e.source.kind !== 'opening').map(e => ({ kind: e.source.kind, file: (e.source.location as any).artifact, row: (e.source.location as any).row, status: e.rejection ? 'refused' : e.effects.some(f => f.expectedRevision) ? 'update' : !e.effects.length && e.source.kind !== 'trial-balance' ? 'unchanged' : 'ready', reason: e.rejection ?? '', values: e.source.payload })) } : {}),
    trialBalance: r.tbRows.map(t => ({ account: t.account, debit: t.debit, credit: t.credit })),
    refused,
    // Where Xero cannot be reached, the attachments row says why instead of offering to connect.
    notImported: [...r.notImported, ...(source === spreadsheets ? refused.map(row => ({ what: `${row.file}, row ${row.row || 'opening total'}`, count: 1, why: row.reason })) : [])].map(l => l.what === 'Attachments' && attachments && !attachments.available ? { ...l, why: `Xero’s exports carry none. ${attachments.reason}` } : l),
    missingDocuments: source.missingDocuments(openItems) + (attachments && !attachments.available ? ` ${attachments.reason}` : ''),
    files: Object.fromEntries(Object.entries(p.files).map(([k, f]) => [k, { label: source.labels[k] ?? (k === 'mapping' ? 'Column mapping' : k), name: f.name, bytes: f.base64 ? Math.floor(f.base64.length * 3 / 4) - (f.base64.endsWith('==') ? 2 : f.base64.endsWith('=') ? 1 : 0) : new TextEncoder().encode(f.content).length }])),
  } }
}

const preview: Command = { need: 'record', async run(c, b) { return (await prepare(c, b)).preview } }

const commit: Command = { need: 'record', async run(c, b) {
  const { plan, source, preview } = await prepare(c, b)
  const failing = preview.checks.filter(x => !x.ok)
  requireThat(!failing.length, `Resolve before importing: ${failing.map(x => x.title).join('; ')}`, 409)
  requireThat(!preview.refused.length || (source === spreadsheets && b.leaveRefusedOut === true), `${preview.refused.length} rows were refused; correct the export or explicitly leave refused spreadsheet rows out`, 409)
  requireThat(b.fingerprint === plan.fingerprint, 'The files or bank details changed since your preview; review the preview again', 409)
  const prior = await one(c.db, "SELECT COUNT(*) AS n FROM ik_jobs WHERE destination = 'books' AND namespace = ? AND fingerprint = ? AND state IN ('undone', 'rolled_back')", source.namespace, plan.fingerprint)
  const ctx = { ...context(c, source, plan.mappingVersion, 'record'), reviewedFingerprint: plan.fingerprint, operationKey: `${plan.fingerprint}:${Number(prior?.n ?? 0)}` }
  // Creating the reviewed job and applying its first records use separate
  // requests for spreadsheets, each with a fresh measured D1 budget.
  const created = await createD1ImportJob(plan, ctx)
  const job = source === spreadsheets ? created : await applyD1ImportBatches(created, ctx)
  requireThat(job.state === 'completed' || (source === spreadsheets && ['queued', 'applying'].includes(job.state)), `Import stopped in state ${job.state}: ${job.error ?? ''}`, 409)
  const cameIn = Object.fromEntries(Object.entries(preview.counts).map(([k, v]) => [k, v.accepted]))
  await run(c.db, [authority(c.actor, 'record'),
    q('INSERT INTO pt_move_in_reports (job_id, source, cutover_date, came_in, left_out, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', job.id, source.key, preview.cutoverDate, JSON.stringify(cameIn), JSON.stringify(preview.notImported), c.actor.email, now()),
    audit(who(c.actor), 'move-in.import', 'import', job.id, { source: source.key, fingerprint: plan.fingerprint, records: job.total, cutoverDate: preview.cutoverDate })])
  return { job, preview }
} }

/** Large spreadsheets advance through separate bounded HTTP requests. */
const continueImport: Command = { need: 'record', async run(c, b) {
  const prior = await one(c.db, "SELECT * FROM ik_jobs WHERE id = ? AND namespace = ? AND destination = 'books'", text(b.jobId, 'Import'), spreadsheets.namespace)
  requireThat(prior && ['queued', 'applying', 'completed', 'failed'].includes(prior.state), 'This spreadsheet import cannot continue', 409)
  requireThat(!await one(c.db, "SELECT 1 FROM pt_cutovers WHERE status = 'accepted'"), 'The opening balances are posted; this import can no longer continue', 409)
  const job = await applyD1ImportBatches(prior.id, context(c, spreadsheets, prior.mapping_version, 'record'))
  return { job }
} }

/** The accountant's sign-off posts the opening entry once the staged records still tie out. */
const accept: Command = { need: 'post', async run(c, b) {
  const cut = await one(c.db, 'SELECT * FROM pt_cutovers WHERE id = ?', text(b.id, 'Cutover'))
  requireThat(cut, 'Cutover not found', 404)
  requireThat(cut.status === 'staged' && cut.revision === b.revision, 'This cutover changed or is already accepted', 409)
  requireThat(!await one(c.db, "SELECT 1 FROM ik_jobs WHERE destination = 'books' AND state IN ('queued', 'applying', 'failed', 'undoing')"), 'Finish or undo the pending import before signing off', 409)
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
    guard("NOT EXISTS (SELECT 1 FROM ik_jobs WHERE destination = 'books' AND state IN ('queued', 'applying', 'failed', 'undoing'))"),
    approval(who(c.actor), 'cutover', cut.id, cut.revision, 'accept', 'approved', 'Accountant sign-off of trial balance, open items and bank balances'),
    q("UPDATE pt_journal_entries SET status = 'posted', number = (SELECT COALESCE(MAX(number), 0) + 1 FROM pt_journal_entries), posted_by = ?, posted_at = ?, revision = ? WHERE id = ? AND status = 'draft' AND revision = ?", c.actor.email, now(), uid(), entry.id, entry.revision), changed(),
    q("UPDATE pt_cutovers SET status = 'accepted', accepted_by = ?, accepted_at = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'staged'", c.actor.email, now(), uid(), cut.id, cut.revision), changed(),
    audit(who(c.actor), 'move-in.accept', 'cutover', cut.id, { openingEntry: entry.id })])
  return moveInView(c)
} }

/** Undo removes everything the import created (and any attachments carried onto it), only while nothing it staged has changed. */
const undo: Command = { need: 'post', async run(c, b) {
  const job = await one(c.db, `SELECT * FROM ik_jobs WHERE id = ? AND destination = 'books' AND namespace IN (${NAMESPACES.map(() => '?').join(', ')})`, text(b.jobId, 'Import'), ...NAMESPACES)
  requireThat(job && (job.state === 'completed' || (job.namespace === spreadsheets.namespace && ['applying', 'failed', 'undoing'].includes(job.state))), 'Only a staged import is undone', 409)
  const accepted = await one(c.db, "SELECT 1 FROM pt_cutovers WHERE status = 'accepted'")
  requireThat(!accepted, 'The opening balances are posted; correct them with a reversal or adjusting entry instead of undoing the import', 409)
  try {
    const result = await undoD1Import(job.id, context(c, byNamespace(job.namespace), job.mapping_version, 'post'))
    if (result.state === 'undone') await run(c.db, [authority(c.actor, 'post'), ...forgetCarried(), q('DELETE FROM pt_move_in_reports WHERE job_id = ?', job.id), audit(who(c.actor), 'move-in.undo', 'import', job.id, { state: result.state })])
    return { job: result }
  } catch (e) {
    const message = String((e as Error).message)
    if (message.includes('FOREIGN KEY')) throw new Fault(409, 'Records entered after the import still use imported accounts or contacts; undo is no longer possible')
    if (message.includes('IMPORT_SUPERSEDED')) throw new Fault(409, 'A newer import updated these records; undo the latest import first')
    if (message.includes('NATIVE_EDIT_CONFLICT')) throw new Fault(409, 'An imported record has changed since the import; undo would lose that work')
    throw e
  }
} }

export const moveInCommands: Record<string, Command> = {
  'move-in.preview': preview,
  'move-in.commit': commit,
  'move-in.continue': continueImport,
  'move-in.accept': accept,
  'move-in.undo': undo,
  ...xeroCommands,
  ...spreadsheetCommands,
}

export async function moveInView(c: Context) {
  const jobs = (await all(c.db, `SELECT id, namespace, state, checkpoint, total, fingerprint, mapping_version, error FROM ik_jobs WHERE destination = 'books' AND namespace IN (${NAMESPACES.map(() => '?').join(', ')}) ORDER BY rowid DESC`, ...NAMESPACES))
    .map(j => ({ ...j, source: byNamespace(j.namespace).key }))
  const reports = (await all(c.db, 'SELECT * FROM pt_move_in_reports')).map(r => ({ jobId: r.job_id, source: r.source, cutoverDate: r.cutover_date, cameIn: JSON.parse(r.came_in), leftOut: JSON.parse(r.left_out) }))
  return { jobs, reports, cutovers: await all(c.db, 'SELECT * FROM pt_cutovers ORDER BY cutover_date DESC, id'), history: Number((await one(c.db, 'SELECT COUNT(*) AS n FROM pt_history_lines'))?.n ?? 0), xero: await xeroView(c), spreadsheetMappings: await savedSpreadsheetMappings(c.db) }
}
