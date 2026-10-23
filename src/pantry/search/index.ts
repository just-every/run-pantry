// Search projects only fields already readable through each record's native door.
// Authorization is part of each SQL source, before filtering, limits or counts.
import type { Actor, Person } from '../access'
import { authority } from '../access'
import { cents, date, requireThat, type Data } from '../core'
import { all, run } from '../db'

type Source = { kind: string; scope: string; sql: string; amounts?: string; accounts?: string; bank?: string; contact?: string }
const aliases = (contact: string) => `COALESCE((SELECT group_concat(alias,' ') FROM pt_vendor_aliases WHERE vendor_id=${contact}),'')`
const sources: Source[] = [
  { kind: 'invoice', scope: 'invoices', contact: 'r.customer_id', sql: `SELECT r.id,r.kind AS type,r.issue_date AS date,r.number,c.name AS contact,r.total_cents AS amount,r.status,r.memo || ' ' || COALESCE((SELECT group_concat(description,' ') FROM pt_invoice_lines WHERE invoice_id=r.id),'') AS description,r.number || ' ' || c.name AS words FROM pt_invoices r JOIN pt_contacts c ON c.id=r.customer_id`, amounts: 'SELECT amount_cents AS amount FROM pt_invoice_lines WHERE invoice_id=r.id', accounts: 'SELECT account_id FROM pt_invoice_lines WHERE invoice_id=r.id' },
  { kind: 'estimate', scope: 'estimates', sql: `SELECT r.id,'estimate' AS type,r.issue_date AS date,r.number,c.name AS contact,r.total_cents AS amount,r.status,COALESCE(json_extract(r.input,'$.memo'),'') AS description,r.number || ' ' || c.name || ' ' || COALESCE((SELECT group_concat(json_extract(value,'$.description'),' ') FROM json_each(r.input,'$.lines')),'') AS words FROM pt_estimates r JOIN pt_contacts c ON c.id=r.customer_id`, amounts: `SELECT CAST(round(json_extract(value,'$.quantity') * json_extract(value,'$.rate') * 100) AS INTEGER) AS amount FROM json_each(r.input,'$.lines')`, accounts: `SELECT json_extract(value,'$.accountId') AS account_id FROM json_each(r.input,'$.lines')` },
  { kind: 'bill', scope: 'bills', contact: 'r.vendor_id', sql: `SELECT r.id,'bill' AS type,r.bill_date AS date,r.reference AS number,c.name AS contact,r.total_cents AS amount,r.status,r.memo || ' ' || COALESCE((SELECT group_concat(description,' ') FROM pt_bill_lines WHERE bill_id=r.id),'') AS description,r.reference || ' ' || c.name || ' ' || ${aliases('r.vendor_id')} AS words FROM pt_bills r JOIN pt_contacts c ON c.id=r.vendor_id`, amounts: 'SELECT amount_cents AS amount FROM pt_bill_lines WHERE bill_id=r.id', accounts: 'SELECT account_id FROM pt_bill_lines WHERE bill_id=r.id' },
  { kind: 'vendor-credit', scope: 'vendor-credits', sql: `SELECT r.id,'vendor-credit' AS type,r.credit_date AS date,r.reference AS number,c.name AS contact,r.amount_cents AS amount,'recorded' AS status,'' AS description,r.reference || ' ' || c.name || ' ' || ${aliases('r.vendor_id')} AS words FROM pt_vendor_credits r JOIN pt_contacts c ON c.id=r.vendor_id`, accounts: 'SELECT r.account_id AS account_id' },
  { kind: 'payment', scope: 'payments', bank: 'r.bank_account_id', sql: `SELECT r.id,'payment' AS type,r.payment_date AS date,r.reference AS number,c.name AS contact,r.amount_cents AS amount,CASE WHEN r.reversal_id IS NULL THEN 'recorded' ELSE 'reversed' END AS status,r.memo AS description,r.reference || ' ' || c.name || ' ' || ${aliases('r.contact_id')} AS words FROM pt_payments r JOIN pt_contacts c ON c.id=r.contact_id`, accounts: 'SELECT account_id FROM pt_journal_lines WHERE entry_id=r.journal_id' },
  { kind: 'check', scope: 'checks', bank: 'r.bank_account_id', sql: `SELECT r.id,'check' AS type,p.payment_date AS date,CAST(r.number AS TEXT) AS number,r.payee AS contact,p.amount_cents AS amount,r.status,r.memo AS description,CAST(r.number AS TEXT) || ' ' || r.payee AS words FROM pt_checks r JOIN pt_payments p ON p.id=r.payment_id`, accounts: 'SELECT account_id FROM pt_journal_lines WHERE entry_id=p.journal_id' },
  { kind: 'journal', scope: 'journals', sql: `SELECT r.id,'journal' AS type,r.entry_date AS date,CAST(COALESCE(r.number,'') AS TEXT) AS number,'' AS contact,COALESCE((SELECT SUM(debit_cents) FROM pt_journal_lines WHERE entry_id=r.id),0) AS amount,r.status,r.memo || ' ' || COALESCE((SELECT group_concat(memo,' ') FROM pt_journal_lines WHERE entry_id=r.id),'') AS description,CAST(COALESCE(r.number,'') AS TEXT) AS words FROM pt_journal_entries r`, amounts: 'SELECT MAX(debit_cents,credit_cents) AS amount FROM pt_journal_lines WHERE entry_id=r.id', accounts: 'SELECT account_id FROM pt_journal_lines WHERE entry_id=r.id' },
  { kind: 'bank-line', scope: 'bank-lines', bank: 'r.bank_account_id', sql: `SELECT r.id,'bank-line' AS type,r.posted_date AS date,r.reference AS number,r.payee AS contact,r.amount_cents AS amount,CASE WHEN r.excluded_at IS NOT NULL THEN 'excluded' WHEN EXISTS(SELECT 1 FROM pt_match_bank_lines m WHERE m.bank_line_id=r.id AND m.active=1) THEN 'matched' ELSE 'unposted' END AS status,r.description,r.reference || ' ' || r.payee || ' ' || COALESCE(r.feed_txn_id,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM pt_vendor_aliases a JOIN pt_contacts c ON c.id=a.vendor_id WHERE lower(c.name)=lower(r.payee) OR lower(a.alias)=lower(r.payee)),'') AS words FROM pt_bank_lines r WHERE r.removed_at IS NULL`, accounts: 'SELECT account_id FROM pt_bank_accounts WHERE id=r.bank_account_id' },
  { kind: 'pending', scope: 'bank-lines', bank: 'f.bank_account_id', sql: `SELECT r.feed_txn_id AS id,'pending' AS type,r.txn_date AS date,r.feed_txn_id AS number,r.payee AS contact,r.amount_cents AS amount,'pending' AS status,r.description,r.feed_txn_id || ' ' || r.payee AS words FROM pt_feed_pending r JOIN pt_feed_accounts f ON f.id=r.feed_account_id`, accounts: 'SELECT account_id FROM pt_bank_accounts WHERE id=f.bank_account_id' },
  { kind: 'document', scope: 'documents', sql: `SELECT r.id,'document' AS type,substr(r.uploaded_at,1,10) AS date,r.name AS number,COALESCE((SELECT sender FROM pt_receipts WHERE document_id=r.id LIMIT 1),'') AS contact,(SELECT COALESCE(total_cents,read_total_cents) FROM pt_receipts WHERE document_id=r.id LIMIT 1) AS amount,CASE WHEN r.linked_id IS NULL THEN 'unlinked' ELSE 'linked' END AS status,r.note AS description,r.name || ' ' || COALESCE((SELECT group_concat(sender || ' ' || subject || ' ' || COALESCE(vendor,read_vendor,''),' ') FROM pt_receipts WHERE document_id=r.id),'') AS words FROM pt_documents r WHERE r.erased_at IS NULL` },
]

export function searchScopes() { return [...new Set(sources.map(s => s.scope + ':read'))] }
function visible(source: Source, actor: Actor, scopes: string[]) {
  if (actor.kind === 'agent') return false
  if (actor.kind === 'integration') return scopes.includes(source.scope + ':read') || ['invoices','bills','journals','documents'].includes(source.scope) && scopes.includes(source.scope + ':write')
  if (actor.role === 'time-only') return false
  if (actor.role === 'sales') return ['invoice','estimate'].includes(source.kind)
  if (actor.role === 'payables-clerk') return source.kind === 'bill'
  // Arbitrary document text cannot be reliably masked; neither can journal
  // memos whose sources may involve accounts this reader cannot open.
  if (actor.role !== 'owner' && (actor.policy?.maskBank || actor.policy?.maskTin) && source.kind === 'document') return false
  if (actor.role !== 'owner' && actor.policy?.bankAccounts != null && ['document','journal'].includes(source.kind)) return false
  return true
}
const pattern = (s: string) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%'
export async function search(db: D1Database, actor: Actor, query: URLSearchParams, scopes: string[] = []) {
  const q = (query.get('q') ?? '').trim(), type = query.get('type') ?? '', id = query.get('record') ?? ''
  requireThat(q.length <= 200, 'Search is at most 200 characters')
  const limit = Number(query.get('limit') ?? '100')
  requireThat(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'limit is 1–100')
  const cursor = query.get('cursor') ?? ''
  const from = query.get('from') ? date(query.get('from'), 'From date') : null, to = query.get('to') ? date(query.get('to'), 'To date') : null
  requireThat(!from || !to || from <= to, 'From date must be on or before To date')
  const min = query.get('min') ? Math.abs(cents(query.get('min'), 'Minimum', { signed: true, zero: true })) : null
  const max = query.get('max') ? Math.abs(cents(query.get('max'), 'Maximum', { signed: true, zero: true })) : null
  requireThat(min === null || max === null || min <= max, 'Minimum must not exceed maximum')
  const amount = /^-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(q) ? Math.abs(cents(q, 'Amount', { signed: true, zero: true })) : null
  const queries: {sql:string;params:unknown[]}[] = []
  for (const source of sources.filter(s => visible(s,actor,scopes))) {
    if (type && ![source.kind, ...(source.kind === 'invoice' ? ['credit'] : [])].includes(type)) continue
    const params: unknown[] = []
    let base = source.sql
    const clauses: string[] = []
    // Money in/out search ignores sign, while result amounts keep their sign.
    // Numeric text is also a reference (e.g. check 1047), never amount only.
    if (q) {
      const terms = q.split(/\s+/).map(() => "lower(description || ' ' || words || ' ' || contact) LIKE lower(?) ESCAPE '\\'")
      clauses.push(`((${terms.join(' AND ')})${amount === null ? '' : ' OR abs(amount)=? OR lineAmount=1'})`)
      params.push(...q.split(/\s+/).map(pattern)); if(amount !== null) params.push(amount)
    }
    if (amount !== null && source.amounts) {
      base = base.replace(/ FROM (pt_\w+ r\b)/, `, EXISTS(SELECT 1 FROM (${source.amounts}) WHERE abs(amount)=?) AS lineAmount FROM $1`)
      // The first placeholder lives in the source before the outer filter.
      params.splice(params.length - (q ? q.split(/\s+/).length + 1 : 0),0,amount)
    } else base = base.replace(/ FROM (pt_\w+ r\b)/, ', 0 AS lineAmount FROM $1')
    // Bank visibility is evaluated in the source, not after a capped result.
    const person = actor.kind === 'person' ? actor as Person : null
    const restricted = person?.role !== 'owner' && person?.policy?.bankAccounts != null
    const inside: string[] = [], insideParams: unknown[] = []
    if(restricted && source.bank) { inside.push(`${source.bank} IN (SELECT value FROM json_each(?))`); insideParams.push(JSON.stringify(person!.policy!.bankAccounts)) }
    if(query.get('account') && source.accounts) { inside.push(`EXISTS(SELECT 1 FROM (${source.accounts}) WHERE account_id=?)`); insideParams.push(query.get('account')) }
    else if(query.get('account')) inside.push('0')
    if(inside.length) {
      base += (source.sql.includes(' WHERE r.') ? ' AND ' : ' WHERE ') + inside.join(' AND ')
      // Source placeholders precede outer predicates.
      const outerCount = q ? q.split(/\s+/).length + (amount===null?0:1) : 0
      params.splice(params.length-outerCount,0,...insideParams)
    }
    if(type) { clauses.push('type=?'); params.push(type==='invoice'?'invoice':type) }
    if(id) { clauses.push('id=?'); params.push(id) }
    if(from) { clauses.push('date>=?'); params.push(from) }
    if(to) { clauses.push('date<=?'); params.push(to) }
    if(min!==null) { clauses.push('abs(amount)>=?'); params.push(min) }
    if(max!==null) { clauses.push('abs(amount)<=?'); params.push(max) }
    if(query.get('status')) { clauses.push('status=?'); params.push(query.get('status')) }
    clauses.push("type || ':' || id > ?"); params.push(cursor)
    queries.push({sql:`SELECT id,type,date,number,contact,amount,status,description FROM (${base}) WHERE ${clauses.join(' AND ')} ORDER BY type,id LIMIT ?`,params:[...params,limit+1]})
  }
  if(!queries.length)return { groups: [], nextCursor: null }
  // D1 caps compound SELECTs. One snapshot batch bounds each family, then a
  // stable merge gives the same page without reading unbounded native rows.
  const pages=await db.batch<Data>(queries.map(p=>db.prepare(p.sql).bind(...p.params)))
  const rows=pages.flatMap(p=>p.results).sort((a,b)=>a.type<b.type?-1:a.type>b.type?1:a.id<b.id?-1:a.id>b.id?1:0).slice(0,limit+1)
  const more = rows.length > limit; if(more)rows.pop()
  // A revoked native session/credential may not obtain even the projected rows.
  if(actor.kind==='person')await run(db,[authority(actor,'read')])
  const groups = [...new Set(rows.map(r=>r.type))].map(type=>({type,records:rows.filter(r=>r.type===type).map(r=>({...r,href:'/app/search?'+new URLSearchParams({type:r.type,record:r.id})}))}))
  return { groups, nextCursor: more ? `${rows.at(-1)!.type}:${rows.at(-1)!.id}` : null }
}
