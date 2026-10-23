// What doesn't add up, found by plain rules over the books: a deposit nothing
// explains, money out still unfiled or a cost without its receipt past a set
// age, the same payment made twice, and a bank balance the books cannot reach.
// Each finding becomes one question with the answers that would settle it,
// every answer naming exactly what it changes. Receipt routing may prepare
// an owner-consented question; financial entries are never written here.
import { addDays, daysBetween, longDay, monthBounds, usd, type Data } from '../core'
import { all, one } from '../db'
import { payeeKey } from '../rules'
import { prepareReceiptRequests } from '../receipts/chase'
import { missingReceipts } from '../receipts/attachments'

export type Action =
  | { type: 'category'; accountId: string }
  | { type: 'invoice'; invoiceId: string; contactId: string }
  | { type: 'bill'; billId: string; contactId: string }
  | { type: 'transfer'; otherBankAccountId: string }
  | { type: 'posting'; journalLineId: string }
  | { type: 'no-receipt' }
  | { type: 'note' }
  | { type: 'dismiss' }
/** One answer the owner can give. `learn`: it can become a bank rule. `note`: it needs a few words. `from`: where a category came from. */
export type Choice = { id: string; label: string; effect: string; action: Action; learn?: boolean; note?: string; from?: 'history' | 'usual' | 'guess' }
export type Issue = {
  kind: 'unmatched-deposit' | 'unfiled' | 'missing-receipt' | 'duplicate-payment' | 'balance-mismatch'
  fingerprint: string; subjectKind: string; subjectId: string; period: string; recordDate: string; amount: number
  title: string; question: string; why: string; facts: Data; choices: Choice[]
  /** For a line to file: what the model may be asked to suggest a category for. */
  line?: Data
}
export type Settings = { deposit_days: number; file_days: number; receipt_cents: number }

const shortDay = (d: string) => longDay(d).replace(/, \d{4}$/, '')
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())

/** The month's accrual net income, so an answer can say what it moves. */
export class NetIncome {
  private cache = new Map<string, number>()
  constructor(private db: D1Database) {}
  async of(period: string) {
    if (!this.cache.has(period)) {
      const { start, end } = monthBounds(period)
      const r = await one<{ n: number }>(this.db, `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS n FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id
        WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND a.type IN ('income', 'expense')`, start, end)
      this.cache.set(period, Number(r?.n ?? 0))
    }
    return this.cache.get(period)!
  }
}

const MONTH = (period: string) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(period.slice(5, 7)) - 1]

/** "Files it to 6200 Software; October net income $9,840.00 → $9,785.01." */
export async function categoryEffect(net: NetIncome, account: Data, signed: number, period: string) {
  const to = `Files it to ${account.code} ${account.name}`
  if (account.type !== 'income' && account.type !== 'expense') return `${to}; net income does not change.`
  const before = await net.of(period)
  return `${to}; ${MONTH(period)} net income ${usd(before)} → ${usd(before + signed)}.`
}

type Ctx = { db: D1Database; today: string; settings: Settings; net: NetIncome; accounts: Data[]; locked: Data[]; banks: Data[] }

const lockedOn = (c: Ctx, day: string) => c.locked.some(p => day >= p.start_date && day <= p.end_date)
const accountById = (c: Ctx, id: string) => c.accounts.find(a => a.id === id)

/** Where people filed this payee before, most often first. */
async function history(c: Ctx, line: Data) {
  const key = payeeKey(line), direction = line.amount_cents < 0 ? 'out' : 'in'
  if (!key) return []
  const rows = await all(c.db, `SELECT l.payee, l.description, l.amount_cents, jl.account_id FROM pt_matches m
    JOIN pt_match_bank_lines mb ON mb.match_id = m.id AND mb.active = 1 JOIN pt_bank_lines l ON l.id = mb.bank_line_id
    JOIN pt_match_postings mp ON mp.match_id = m.id AND mp.active = 1 JOIN pt_journal_lines bl ON bl.id = mp.journal_line_id
    JOIN pt_journal_entries e ON e.id = bl.entry_id AND e.source_kind = 'bank' JOIN pt_journal_lines jl ON jl.entry_id = e.id AND jl.id <> bl.id
    WHERE m.status = 'approved' AND l.bank_account_id = ? ORDER BY l.posted_date DESC LIMIT 1000`, line.bank_account_id)
  const counts = new Map<string, number>()
  for (const r of rows) if (payeeKey(r) === key && (r.amount_cents < 0 ? 'out' : 'in') === direction) counts.set(r.account_id, (counts.get(r.account_id) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ account: accountById(c, id), n })).filter(x => x.account?.active && !['receivable', 'payable', 'retained'].includes(x.account.subtype))
}

/** A past filing, offered again: to a category, or (when it went to another bank account) as a transfer. */
async function asBefore(c: Ctx, line: Data, h: { account?: Data; n: number }): Promise<Choice | null> {
  const a = h.account!
  if (a.subtype !== 'bank') return categoryChoice(c, line, a, `${a.name}, as before (${plural(h.n, 'time')})`, 'history')
  const other = c.banks.find(b => b.account_id === a.id && b.id !== line.bank_account_id)
  return other ? { id: `transfer:${other.id}`, label: `Money moved ${line.amount_cents < 0 ? 'to' : 'from'} ${other.name}, as before (${plural(h.n, 'time')})`, effect: `Records a transfer ${line.amount_cents < 0 ? 'to' : 'from'} ${other.name}; net income does not change.`, action: { type: 'transfer', otherBankAccountId: other.id }, from: 'history' } : null
}

/** The categories people used most in the last 90 days, for a payee Pantry has never seen. */
async function usual(c: Ctx, type: 'income' | 'expense') {
  return (await all(c.db, `SELECT l.account_id, COUNT(*) AS n FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND a.type = ? AND a.active = 1 AND e.entry_date >= ? GROUP BY l.account_id ORDER BY n DESC, a.code LIMIT 3`, type, addDays(c.today, -90))).map(r => accountById(c, r.account_id)!).filter(Boolean)
}

/** The owner's equity account for money in or out that is the owner's own. */
function ownerAccount(c: Ctx, out: boolean) {
  const equity = c.accounts.filter(a => a.active && a.type === 'equity' && a.subtype === 'other')
  return (out ? equity.find(a => /draw|distribution/i.test(a.name)) : equity.find(a => /contribut|capital|invest/i.test(a.name))) ?? equity.find(a => /owner|equity|capital/i.test(a.name)) ?? equity[0]
}

async function categoryChoice(c: Ctx, line: Data, account: Data, label: string, from?: Choice['from']): Promise<Choice> {
  return { id: `account:${account.id}`, label, ...(from ? { from } : {}), effect: await categoryEffect(c.net, account, line.amount_cents < 0 ? -Math.abs(line.amount_cents) : line.amount_cents, line.posted_date.slice(0, 7)), action: { type: 'category', accountId: account.id }, learn: true }
}

const OPEN_LINES = `SELECT l.*, b.name AS bank_name, b.account_id AS ledger_account_id FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id
  WHERE l.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines m WHERE m.bank_line_id = l.id AND m.active = 1)`

/** Payments and entries already in the books that this line could be: same account and amount, within ten days. */
async function recorded(c: Ctx, line: Data): Promise<Choice[]> {
  const rows = await all(c.db, `SELECT l.id, e.entry_date, e.memo FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
    WHERE e.status = 'posted' AND e.reversed_by_id IS NULL AND l.account_id = ? AND l.debit_cents - l.credit_cents = ? AND e.entry_date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM pt_match_postings m WHERE m.journal_line_id = l.id AND m.active = 1) ORDER BY abs(julianday(e.entry_date) - julianday(?)) LIMIT 2`,
    line.ledger_account_id, line.amount_cents, addDays(line.posted_date, -10), addDays(line.posted_date, 10), line.posted_date)
  return rows.map(r => ({ id: `posting:${r.id}`, label: `${r.memo}, recorded ${shortDay(r.entry_date)}`, effect: 'Matches it to what you already recorded; nothing new is posted.', action: { type: 'posting', journalLineId: r.id } }))
}

function lineFacts(line: Data) {
  return { Date: longDay(line.posted_date), Account: line.bank_name, 'The bank says': line.description, ...(line.payee ? { Payee: line.payee } : {}), Amount: usd(line.amount_cents), From: line.source === 'feed' ? 'Bank feed' : 'Imported statement' }
}

async function deposits(c: Ctx, lines: Data[]): Promise<Issue[]> {
  const out: Issue[] = []
  const invoices = await all(c.db, `SELECT i.id, i.number, i.issue_date, i.total_cents, i.customer_id, c.name AS customer FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id
    WHERE i.kind = 'invoice' AND i.status = 'issued' ORDER BY i.issue_date, i.number`)
  const open: Data[] = []
  for (const inv of invoices) {
    const applied = Number((await one(c.db, `SELECT COALESCE(SUM(a.amount_cents), 0) AS n FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
      WHERE a.target_kind = 'invoice' AND a.target_id = ? AND (a.source_kind = 'credit' OR p.reversal_id IS NULL) AND a.voided_by IS NULL`, inv.id))?.n ?? 0)
    if (inv.total_cents - applied > 0) open.push({ ...inv, open: inv.total_cents - applied })
  }
  for (const line of lines.filter(l => l.amount_cents > 0 && daysBetween(l.posted_date, c.today) >= c.settings.deposit_days)) {
    const choices: Choice[] = await recorded(c, line)
    for (const inv of open.filter(i => i.open === line.amount_cents && i.issue_date <= line.posted_date).slice(0, 2))
      choices.push({ id: `invoice:${inv.id}`, label: `${inv.customer} paying invoice ${inv.number}`, effect: `Records ${inv.customer}'s payment of ${usd(line.amount_cents)} and marks invoice ${inv.number} paid; net income does not change.`, action: { type: 'invoice', invoiceId: inv.id, contactId: inv.customer_id } })
    const mirror = lines.find(o => o.bank_account_id !== line.bank_account_id && o.amount_cents === -line.amount_cents && Math.abs(daysBetween(o.posted_date, line.posted_date)) <= 3)
    if (mirror) choices.push({ id: `transfer:${mirror.bank_account_id}`, label: `Money moved from ${mirror.bank_name}`, effect: `Records a transfer from ${mirror.bank_name}; net income does not change.`, action: { type: 'transfer', otherBankAccountId: mirror.bank_account_id } })
    for (const h of (await history(c, line)).slice(0, 1)) { const x = await asBefore(c, line, h); if (x && !choices.some(y => y.id === x.id)) choices.push(x) }
    const owner = ownerAccount(c, false)
    if (owner && !choices.some(x => x.id === `account:${owner.id}`)) choices.push(await categoryChoice(c, line, owner, 'Money you put into the business'))
    const sales = (await usual(c, 'income'))[0] ?? c.accounts.find(a => a.active && a.type === 'income')
    if (sales && choices.length < 4 && !choices.some(x => x.id === `account:${sales.id}`)) choices.push(await categoryChoice(c, line, sales, `A sale you did not invoice in Pantry (${sales.name})`, 'usual'))
    out.push({
      kind: 'unmatched-deposit', fingerprint: `deposit:${line.id}`, subjectKind: 'bank-line', subjectId: line.id, period: line.posted_date.slice(0, 7), recordDate: line.posted_date, amount: line.amount_cents,
      title: `${usd(line.amount_cents)} deposit on ${shortDay(line.posted_date)}`,
      question: `What was the ${usd(line.amount_cents)} that came into ${line.bank_name} on ${longDay(line.posted_date)}?`,
      why: `Nothing in the books is matched to it yet, ${daysBetween(line.posted_date, c.today)} days on, so Pantry cannot tell whether it is income.`,
      facts: lineFacts(line), choices: choices.slice(0, 4), line,
    })
  }
  return out
}

async function unfiled(c: Ctx, lines: Data[]): Promise<Issue[]> {
  const out: Issue[] = []
  const bills = await all(c.db, `SELECT b.id, b.reference, b.bill_date, b.total_cents, b.vendor_id, v.name AS vendor FROM pt_bills b JOIN pt_contacts v ON v.id = b.vendor_id WHERE b.status = 'posted' ORDER BY b.bill_date`)
  for (const line of lines.filter(l => l.amount_cents < 0 && daysBetween(l.posted_date, c.today) >= c.settings.file_days)) {
    const abs = -line.amount_cents, choices: Choice[] = await recorded(c, line)
    for (const bill of bills.filter(b => b.bill_date <= line.posted_date).slice(-20)) {
      if (choices.length >= 1) break
      const applied = Number((await one(c.db, `SELECT COALESCE(SUM(a.amount_cents), 0) AS n FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
        WHERE a.target_kind = 'bill' AND a.target_id = ? AND (a.source_kind = 'credit' OR p.reversal_id IS NULL)`, bill.id))?.n ?? 0)
      if (bill.total_cents - applied === abs) choices.push({ id: `bill:${bill.id}`, label: `Paying ${bill.vendor}'s bill ${bill.reference}`, effect: `Records the payment to ${bill.vendor} and marks bill ${bill.reference} paid; net income does not change.`, action: { type: 'bill', billId: bill.id, contactId: bill.vendor_id } })
    }
    for (const h of (await history(c, line)).slice(0, 2)) { const x = await asBefore(c, line, h); if (x) choices.push(x) }
    if (!choices.some(x => x.from === 'history'))
      for (const a of (await usual(c, 'expense')).slice(0, 2)) if (!choices.some(x => x.id === `account:${a.id}`)) choices.push(await categoryChoice(c, line, a, a.name, 'usual'))
    const owner = ownerAccount(c, true)
    if (owner && !choices.some(x => x.id === `account:${owner.id}`)) choices.push(await categoryChoice(c, line, owner, `A personal cost, not the business's (${owner.name})`))
    out.push({
      kind: 'unfiled', fingerprint: `unfiled:${line.id}`, subjectKind: 'bank-line', subjectId: line.id, period: line.posted_date.slice(0, 7), recordDate: line.posted_date, amount: line.amount_cents,
      title: `${usd(abs)} ${line.payee ? 'to ' + title(line.payee) : 'payment'} on ${shortDay(line.posted_date)}`,
      question: `What was the ${usd(abs)} ${line.payee ? `paid to ${title(line.payee)}` : `that left ${line.bank_name}`} on ${longDay(line.posted_date)} for?`,
      why: `It has no category yet, ${daysBetween(line.posted_date, c.today)} days on, so it is missing from your reports.`,
      facts: lineFacts(line), choices: choices.slice(0, 4), line,
    })
  }
  return out
}

async function receipts(c: Ctx): Promise<Issue[]> {
  await prepareReceiptRequests(c.db, c.today)
  const before = addDays(c.today, -c.settings.file_days), out: Issue[] = []
  const bills = await all(c.db, `SELECT b.id, b.reference, b.bill_date, b.total_cents, v.name AS vendor FROM pt_bills b JOIN pt_contacts v ON v.id = b.vendor_id
    WHERE b.status = 'posted' AND b.evidence_waived IS NULL AND b.bill_date <= ? AND b.total_cents >= ?
      AND NOT EXISTS (SELECT 1 FROM pt_documents d WHERE d.linked_kind = 'bill' AND d.linked_id = b.id) ORDER BY b.bill_date LIMIT 100`, before, c.settings.receipt_cents)
  for (const b of bills) out.push({
    kind: 'missing-receipt', fingerprint: `receipt:bill:${b.id}`, subjectKind: 'bill', subjectId: b.id, period: b.bill_date.slice(0, 7), recordDate: b.bill_date, amount: -b.total_cents,
    title: `Receipt for ${b.vendor} bill ${b.reference}`,
    question: `Do you have the bill or receipt for ${b.vendor}'s ${b.reference} (${usd(b.total_cents)}, ${longDay(b.bill_date)})?`,
    why: `The bill is posted without its source document, ${daysBetween(b.bill_date, c.today)} days on; your accountant needs one for every cost.`,
    facts: { Date: longDay(b.bill_date), Vendor: b.vendor, Bill: b.reference, Amount: usd(b.total_cents) },
    choices: [{ id: 'no-receipt', label: 'There is no receipt', effect: 'Records your reason on the bill, so the close and your accountant see why.', action: { type: 'no-receipt' }, note: 'Why there is none' }],
  })
  // Spending from a bank or card with no receipt and no recorded reason, as the close's Receipts card lists it.
  const entries = (await missingReceipts(c.db, '0000-01-01', before)).filter(e => e.amount_cents >= c.settings.receipt_cents).slice(0, 100)
  for (const e of entries) {
    // Only costs want a receipt; money the owner took out (equity) or a loan payment does not.
    if (!await one(c.db, "SELECT 1 FROM pt_journal_lines l JOIN pt_accounts a ON a.id = l.account_id WHERE l.entry_id = ? AND a.type = 'expense'", e.id)) continue
    e.cost = e.amount_cents
    Object.assign(e, await one(c.db, `SELECT bl.description, bl.payee, ba.name AS bank_name FROM pt_journal_lines jl JOIN pt_match_postings mp ON mp.journal_line_id = jl.id AND mp.active = 1
      JOIN pt_match_bank_lines mb ON mb.match_id = mp.match_id AND mb.active = 1 JOIN pt_bank_lines bl ON bl.id = mb.bank_line_id JOIN pt_bank_accounts ba ON ba.id = bl.bank_account_id WHERE jl.entry_id = ? LIMIT 1`, e.id) ?? {})
    const what = e.payee ? title(e.payee) : e.description ?? e.memo
    out.push({
      kind: 'missing-receipt', fingerprint: `receipt:journal:${e.id}`, subjectKind: 'journal', subjectId: e.id, period: e.entry_date.slice(0, 7), recordDate: e.entry_date, amount: -e.cost,
      title: `Receipt for ${usd(e.cost)} ${what} on ${shortDay(e.entry_date)}`,
      question: `Do you have the receipt for the ${usd(e.cost)} ${what} charge on ${longDay(e.entry_date)}?`,
      why: `It is filed as a business cost without a receipt, ${daysBetween(e.entry_date, c.today)} days on.`,
      facts: { Date: longDay(e.entry_date), ...(e.bank_name ? { Account: e.bank_name } : {}), ...(e.description ? { 'The bank says': e.description } : {}), Amount: usd(e.cost), Filed: e.memo },
      choices: [{ id: 'no-receipt', label: 'There is no receipt', effect: 'Records your reason on the entry (No receipt needed), so the close and your accountant see why.', action: { type: 'no-receipt' }, note: 'Why there is none' }],
    })
  }
  return out
}

const DUPLICATE_CHOICES: Choice[] = [
  { id: 'refund', label: 'Yes, I paid twice; I will get the money back', effect: 'Keeps your note with both payments; nothing in the books changes until the refund arrives.', action: { type: 'note' } },
  { id: 'both-right', label: 'No, both payments are right', effect: 'Pantry stops asking about these two; nothing changes.', action: { type: 'dismiss' } },
]

async function duplicates(c: Ctx): Promise<Issue[]> {
  const out: Issue[] = []
  const pairs = await all(c.db, `SELECT a.id AS a_id, b.id AS b_id, a.payment_date AS a_date, b.payment_date AS b_date, a.amount_cents, a.reference AS a_ref, b.reference AS b_ref, v.name AS vendor
    FROM pt_payments a JOIN pt_payments b ON b.contact_id = a.contact_id AND b.amount_cents = a.amount_cents AND b.id > a.id AND b.direction = 'paid' AND b.reversal_id IS NULL
    JOIN pt_contacts v ON v.id = a.contact_id
    WHERE a.direction = 'paid' AND a.reversal_id IS NULL AND abs(julianday(a.payment_date) - julianday(b.payment_date)) <= 10 LIMIT 50`)
  for (const p of pairs) {
    const [first, second] = p.a_date <= p.b_date ? [p.a_date, p.b_date] : [p.b_date, p.a_date]
    out.push({
      kind: 'duplicate-payment', fingerprint: `duplicate:payment:${[p.a_id, p.b_id].sort().join(':')}`, subjectKind: 'payment', subjectId: p.a_date <= p.b_date ? p.b_id : p.a_id, period: second.slice(0, 7), recordDate: second, amount: -p.amount_cents,
      title: `${p.vendor} paid ${usd(p.amount_cents)} twice`,
      question: `Did you pay ${p.vendor} ${usd(p.amount_cents)} twice, on ${longDay(first)} and ${longDay(second)}?`,
      why: `Two payments of the same amount to the same vendor ${daysBetween(first, second) === 0 ? 'on the same day' : `${plural(daysBetween(first, second), 'day')} apart`} are usually one bill paid twice.`,
      facts: { Vendor: p.vendor, Amount: usd(p.amount_cents), 'First payment': `${longDay(first)}${p.a_ref ? ` · ${p.a_ref}` : ''}`, 'Second payment': `${longDay(second)}${p.b_ref ? ` · ${p.b_ref}` : ''}` },
      choices: DUPLICATE_CHOICES,
    })
  }
  // The bank charged the same payee the same amount twice within three days.
  const lines = await all(c.db, `SELECT l.*, b.name AS bank_name FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id WHERE l.removed_at IS NULL AND l.amount_cents < 0 AND l.posted_date >= ? ORDER BY l.posted_date, l.id`, addDays(c.today, -120))
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length && daysBetween(lines[i].posted_date, lines[j].posted_date) <= 3; j++) {
    const a = lines[i], b = lines[j], key = payeeKey(a)
    if (a.bank_account_id !== b.bank_account_id || a.amount_cents !== b.amount_cents || !key || payeeKey(b) !== key) continue
    out.push({
      kind: 'duplicate-payment', fingerprint: `duplicate:bank:${[a.id, b.id].sort().join(':')}`, subjectKind: 'bank-line', subjectId: b.id, period: b.posted_date.slice(0, 7), recordDate: b.posted_date, amount: b.amount_cents,
      title: `${title(key)} charged ${usd(-a.amount_cents)} twice`,
      question: `Did ${title(key)} charge you ${usd(-a.amount_cents)} twice, on ${longDay(a.posted_date)}${a.posted_date === b.posted_date ? '' : ` and ${longDay(b.posted_date)}`}?`,
      why: `${a.bank_name} shows two charges of the same amount from the same payee ${a.posted_date === b.posted_date ? 'on the same day' : `${plural(daysBetween(a.posted_date, b.posted_date), 'day')} apart`}.`,
      facts: { Account: a.bank_name, 'The bank says': `${a.description} · ${longDay(a.posted_date)}`, 'And again': `${b.description} · ${longDay(b.posted_date)}`, Amount: usd(-a.amount_cents) },
      choices: DUPLICATE_CHOICES,
    })
  }
  return out
}

/**
 * The latest statement's closing balance against the books: the books' balance
 * when the account opened plus every transaction the bank sent through that
 * day. Whatever is left over is money the bank has and the books cannot reach.
 */
async function balances(c: Ctx): Promise<Issue[]> {
  const out: Issue[] = []
  for (const bank of c.banks) {
    const st = await one(c.db, 'SELECT * FROM pt_statements WHERE bank_account_id = ? ORDER BY end_date DESC, imported_at DESC LIMIT 1', bank.id)
    if (!st || lockedOn(c, st.end_date)) continue
    const opening = Number((await one(c.db, `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
      WHERE e.status = 'posted' AND l.account_id = ? AND e.entry_date <= ?`, bank.account_id, bank.opening_date))?.n ?? 0)
    const moved = Number((await one(c.db, 'SELECT COALESCE(SUM(amount_cents), 0) AS n FROM pt_bank_lines WHERE bank_account_id = ? AND removed_at IS NULL AND posted_date > ? AND posted_date <= ?', bank.id, bank.opening_date, st.end_date))?.n ?? 0)
    const gap = st.closing_cents - (opening + moved)
    if (gap === 0) continue
    const books = Number((await one(c.db, `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
      WHERE e.status = 'posted' AND l.account_id = ? AND e.entry_date <= ?`, bank.account_id, st.end_date))?.n ?? 0)
    out.push({
      kind: 'balance-mismatch', fingerprint: `balance:${bank.id}:${st.id}:${gap}`, subjectKind: 'statement', subjectId: st.id, period: st.end_date.slice(0, 7), recordDate: st.end_date, amount: gap,
      title: `${bank.name} is ${usd(Math.abs(gap))} ${gap > 0 ? 'over' : 'under'} the books`,
      question: `The ${bank.name} statement says ${usd(st.closing_cents)} on ${longDay(st.end_date)}, ${usd(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than the books can account for. Do you know why?`,
      why: `Your books opened ${bank.name} at ${usd(opening)} on ${longDay(bank.opening_date)}; with every transaction the bank sent since, that comes to ${usd(opening + moved)}, not ${usd(st.closing_cents)}.`,
      facts: { Account: bank.name, Statement: `${st.source_name} · ${longDay(st.start_date)} to ${longDay(st.end_date)}`, 'Statement balance': usd(st.closing_cents), 'Opening in the books': `${usd(opening)} on ${longDay(bank.opening_date)}`, 'Transactions since': usd(moved), 'Left over': usd(gap), 'Books today': usd(books) },
      choices: [
        { id: 'missing-lines', label: 'Some of the bank’s transactions are not in Pantry yet', effect: 'Keeps your note; import the missing statement and Pantry checks again.', action: { type: 'note' } },
        { id: 'opening', label: 'The opening balance in the books is wrong', effect: 'Keeps your note for your accountant, who corrects the opening entry.', action: { type: 'note' } },
      ],
    })
  }
  return out
}

/** Everything that doesn't add up today, oldest first. Records in a locked month are left alone. */
export async function findIssues(db: D1Database, settings: Settings, today: string): Promise<Issue[]> {
  const c: Ctx = {
    db, today, settings, net: new NetIncome(db),
    accounts: await all(db, 'SELECT * FROM pt_accounts ORDER BY code'),
    locked: await all(db, "SELECT * FROM pt_periods WHERE status = 'locked'"),
    banks: await all(db, 'SELECT * FROM pt_bank_accounts ORDER BY name'),
  }
  const lines = (await all(db, `${OPEN_LINES} ORDER BY l.posted_date, l.id LIMIT 500`)).filter(l => !lockedOn(c, l.posted_date))
  const issues = [...await deposits(c, lines), ...await unfiled(c, lines), ...await receipts(c), ...await duplicates(c), ...await balances(c)]
  return issues.filter(i => !lockedOn(c, i.recordDate)).sort((a, b) => a.recordDate.localeCompare(b.recordDate) || a.fingerprint.localeCompare(b.fingerprint))
}
