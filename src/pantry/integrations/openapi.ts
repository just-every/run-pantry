// API-001: the implemented scoped transport, not the larger target contract.
// Schemas describe wire values; native parsers still enforce accounting rules.
import { FINANCIAL_REPORTS } from '../report-reader'
import { INTEGRATION_REQUESTS_PER_MINUTE } from './rate-limit'
import { recordResources } from './resources'
import { resourceSchema } from './resources/schema'

type Schema = Record<string, unknown>
const string = { type: 'string' }
const day = { type: 'string', format: 'date' }
const decimal = { type: 'string', description: 'Decimal input in USD (quantities and rates also use decimal strings).' }
const bool = { type: 'boolean' }
const dimensionInputs={className:string,locationName:string,projectName:string}
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, ...(required.length ? { required } : {}) })
const array = (items: Schema): Schema => ({ type: 'array', items })
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` })
const query = (name: string, schema: Schema = string, description?: string) => ({ name, in: 'query', required: false, schema, ...(description ? { description } : {}) })
const id = { name: 'id', in: 'path', required: true, schema: string }
const paging = [query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 100 }), query('cursor', string, 'Exclusive stable record-ID cursor returned as nextCursor; not a date or page number.')]
const json = (schema: Schema) => ({ 'application/json': { schema } })
const rateHeaders = Object.fromEntries(['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'].map(name => [name, { description: name === 'X-RateLimit-Reset' ? 'Budget reset time as Unix seconds.' : name === 'X-RateLimit-Limit' ? 'Requests allowed per credential per UTC minute.' : 'Requests remaining in this budget after this request.', schema: { type: 'integer', minimum: 0 } }]))
const errors = Object.fromEntries(Object.entries({ 400: 'Invalid request', 401: 'Missing, invalid or revoked credential', 403: 'Missing scope or invalid host', 404: 'Record or route not found', 409: 'Changed state, locked period or conflicting idempotency key', 413: 'Request too large', 429: 'Credential request budget exhausted; retry after Retry-After seconds' }).map(([status, description]) => [status, { description, content: json(ref('Error')), ...(status !== '401' ? { headers: { ...rateHeaders, ...(status === '429' ? { 'Retry-After': { description: 'Whole seconds until the next UTC-minute budget, at least 1.', schema: { type: 'integer', minimum: 1 } } } : {}) } } : {}) }]))
const operation = (operationId: string, summary: string, scopes: string[], response: Schema, parameters: unknown[] = [], body?: string, description = '') => ({
  operationId, summary, description, 'x-pantry-scopes': scopes,
  ...(parameters.length ? { parameters } : {}),
  ...(body ? { requestBody: { required: true, content: json(ref(body)) } } : {}),
  responses: { 200: { description: 'Success; writes and idempotent replays return the current record.', headers: rateHeaders, content: json(response) }, ...errors },
})
const key = { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Unique per credential across operations. Reuse with the same path and body returns the current record. Object key order is immaterial; array order is significant. A changed body or operation returns 409.' }
const record = object({ id: string, revision: string }, ['id'])
const list = (name: string, schema = ref('Record')) => object({ [name]: array(schema), nextCursor: { type: ['string', 'null'] } }, [name, 'nextCursor'])
const invoiceLine = object({ ...dimensionInputs,itemId: string, kind: { enum: ['item', 'delivery'] }, description: string, quantity: decimal, rate: decimal, accountId: string, taxCode: { ...string, description: 'Tax-code ID or exempt. Required for issuing; omitted fields may use an item default.' } })
const allocation = object({ targetId: string, amount: decimal }, ['targetId', 'amount'])
const vendorCreditWriteDescription = 'Requires vendor-credits:write AND post, including when post is omitted. Vendor credits are already posted; post:false is refused. Native same-vendor, open posted bill, remaining-credit, open-balance and period-lock guards apply atomically. No money moves. Idempotent replays return the current credit with allocations and unallocated_cents.'
const paths: Record<string, unknown> = {
  '/openapi.json': { get: operation('getOpenApi', 'Read this implemented v1 API description', [], object({}), [], undefined, 'Uses the same valid integration credential as the other routes. Contains no installation records or secrets.') },
  '/state': { get: operation('getState', 'Read account and tax-code mappings', ['any record scope'], object({ accounts: array(object({})), taxCodes: array(object({})), bankAccounts: array(object({})), contacts: array(ref('Record')), nextCursor: { type: ['string', 'null'] } }), [...paging, query('id'), query('name')], undefined, 'Contacts and their cursor appear only with contacts:write. Bank-account mappings appear only with payments:read or payments:write. This route creates no accounts.') },
}
for (const spec of [
  { path: 'contacts', scope: 'contacts:write', key: 'contacts', filters: ['id', 'name', 'kind', 'active'], body: 'ContactInput' },
  { path: 'bills', scope: 'bills:write', key: 'bills', filters: ['id', 'reference', 'vendorId', 'status', 'date'], body: 'BillInput' },
  { path: 'invoices', scope: 'invoices:write', key: 'invoices', filters: ['id', 'number', 'customerId', 'status', 'date'], body: 'InvoiceInput' },
  { path: 'journals', scope: 'journals:write', key: 'entries', filters: ['id', 'memo', 'status', 'date'], body: 'JournalInput' },
  { path: 'documents', scope: 'documents:write', key: 'documents', filters: ['id', 'name', 'linkedId'], body: 'DocumentInput' },
  { path: 'payments', scope: 'payments:write', key: 'payments', filters: ['id', 'reference', 'billId', 'invoiceId'], body: 'PaymentInput' },
]) paths[`/${spec.path}`] = {
  get: operation(`list${spec.path}`, `Read ${spec.path}`, [spec.path + ':read OR ' + spec.scope], list(spec.key), [...paging, ...spec.filters.map(name => query(name, string, name === 'billId' || name === 'invoiceId' ? 'Exact allocation target. billId takes precedence if both are supplied.' : 'Exact whole-value match.'))]),
  post: operation(`create${spec.path}`, `Create ${spec.path}`, [spec.scope], ref('Record'), [key], spec.body, spec.path === 'payments' ? 'Also requires post; records money already moved, never initiates a transfer. post:false is refused.' : 'Bills, invoices and journals stay drafts unless post:true is supplied with the separate post scope. Native approvals, current invoice terms and period-lock checks apply.'),
}
paths['/vendor-credits'] = {
  get: operation('listVendorCredits', 'Read vendor credits and their allocations', ['vendor-credits:read OR vendor-credits:write'], list('vendorCredits', ref('VendorCredit')), [...paging, ...['id', 'vendorId', 'reference'].map(name => query(name, string, 'Exact whole-value match.'))]),
  post: operation('createVendorCredit', 'Record a posted vendor credit', ['vendor-credits:write', 'post'], ref('VendorCredit'), [key], 'VendorCreditInput', vendorCreditWriteDescription),
}
paths['/vendor-credits/{id}'] = { get: operation('getVendorCredit', 'Read an exact vendor credit', ['vendor-credits:read OR vendor-credits:write'], ref('VendorCredit'), [id], undefined, 'Returns the native credit itself, including all allocations and unallocated_cents. Unknown IDs return 404.') }
paths['/vendor-credits/{id}/allocations'] = { post: operation('allocateVendorCredit', 'Apply remaining vendor credit to bills', ['vendor-credits:write', 'post'], ref('VendorCredit'), [id, key], 'VendorCreditAllocationInput', `${vendorCreditWriteDescription} Allocation date defaults to the credit date and cannot precede it. At least one allocation is required.`) }
paths['/documents/{id}'] = { get: { ...operation('downloadDocument', 'Download original document bytes', ['documents:read OR documents:write'], {}, [id]), responses: { 200: { description: 'Original bytes with the stored media type and attachment filename.', headers: rateHeaders, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, ...errors } } }
paths['/bills/{id}/readiness'] = { post: operation('setBillReadiness', 'Record receipt and readiness of a posted bill', ['bills:write'], ref('Record'), [id, key], 'ReadinessInput', 'Both booleans are required. Ready requires received. This creates no payment; native period locks apply.') }
for (const kind of FINANCIAL_REPORTS) paths[`/reports/${kind}`] = { get: operation(kind === 'trial-balance' ? 'getTrialBalance' : `getReport_${kind.replaceAll('-', '_')}`, `Read ${kind}`, ['reports:read'], kind === 'trial-balance' ? object({ basis: { enum: ['cash', 'accrual'] }, rows: array(object({})) }) : object({}), [
  query('to', day, 'Inclusive end date; defaults to today in UTC.'),
  query('from', day, 'Inclusive start date; defaults to the first day of the to month. As-of reports use to.'),
  query('basis', { enum: ['cash', 'accrual'] }, 'Explicit choice wins; omitted basis uses the declared tax method, or accrual when undeclared. Open items/reconciliation remain accrual, contractor-summary uses payment basis, and indirect cash flow starts from accrual net income.'),
  query('account', string, 'Ledger account filter for general-ledger, transactions and journal.'),
  query('payee', string, 'Exact contact ID filter for transactions and journal.'),
  query('dimension',{enum:['class','location','project']},'General-ledger, trial-balance, profit-and-loss and balance-sheet line filter; other report families refuse it.'),
  query('dimensionValue',string,'Use unassigned or value:CATALOGUE-NAME with dimension.'),
  query('columns', { enum: ['single', 'prior-period', 'prior-year', 'months', 'quarters', 'ytd', 'customer','class','location','project'] }, 'Statement column mode; Customer columns apply to profit-and-loss only; dimension columns also apply to balance-sheet. Dimensions must be enabled; choose a dimension filter or dimension columns.'),
], undefined, 'Returns the same native report fields, integer-cent figures, basis labels, source links and date-range semantics as the corresponding session-authenticated report. Links target the native app and retain its session requirements. This scope does not expose audit history, full TIN exports, custom-report shares, close packages or other native routes. No pagination applies to calculated report results.') }

// All newly delegated records use an explicit field schema and the same bounded envelope.
for (const spec of recordResources) {
  const schema = resourceSchema(spec)
  paths['/' + spec.path] = { get: operation('list_' + spec.path.replaceAll('-', '_'), 'Read ' + spec.path, [spec.scope], list('records', schema), [...paging, ...Object.keys(spec.filters).map(name => query(name, string, 'Exact whole-value match; filters combine with AND.'))], undefined, spec.description) }
  paths['/' + spec.path + '/{id}'] = { get: operation('get_' + spec.path.replaceAll('-', '_'), 'Read an exact ' + spec.path + ' record', [spec.scope], schema, [id], undefined, spec.description) }
}
for (const family of ['contacts', 'invoices', 'bills', 'journals', 'payments']) paths['/' + family + '/{id}'] = {
  get: operation('get_' + family, 'Read an exact ' + family + ' record', [family + ':read OR ' + family + ':write'], ref('Record'), [id], undefined, 'Uses native record calculations with an explicit safe field projection. No hosted-link tokens, credentials or arbitrary snapshots.'),
}
paths['/year-end/{year}'] = { get: operation('getYearEndReadiness', 'Read native fiscal-year close readiness', ['year-end:read'], object({ year: { type: 'integer' }, start: day, end: day, periods: array(string), locked: bool, ready: bool, revision: string, months: array(object({ id: string, status: string, ready: bool, tasksOpen: { type: 'integer' }, hasTasks: bool })), checks: array(object({ key: string, title: string, ok: bool })) }), [{ name: 'year', in: 'path', required: true, schema: { type: 'integer', minimum: 2000, maximum: 9998 } }], undefined, 'Native year-end readiness only; excludes tax identities, payroll records and financial statement snapshots. Read financial reports with reports:read and native REPORT-002 basis selection.') }

export const integrationOpenApi = {
  openapi: '3.1.0',
  info: { title: 'Pantry scoped integration API', version: '1.0.0', description: 'Scoped business records with explicit projections, including integer cents. Owner/security records stay native-owner only. Financial calculations use the native report readers and basis rules. No OAuth, money-movement or production-provider acceptance is implied.' },
  servers: [{ url: '/api/pantry/integration/v1', description: 'This Pantry installation' }],
  security: [{ integrationBearer: [] }], paths,
  'x-pantry-rate-limit': { requests: INTEGRATION_REQUESTS_PER_MINUTE, windowSeconds: 60, scope: 'credential', window: 'fixed UTC minute', description: 'Every valid, non-revoked credential request counts, including discovery, replays, refused scopes, invalid bodies and unknown routes. Excess requests return 429 without domain work and do not extend the window. Missing, invalid and revoked credentials return 401 before quota admission.' },
  components: {
    securitySchemes: { integrationBearer: { type: 'http', scheme: 'bearer', description: 'Owner-issued pantry_integration_ credential. Not a native session or proposal-only agent token. Scope requirements are listed per operation in x-pantry-scopes; post is an additional grant.' } },
    schemas: {
      Error: object({ error: string }, ['error']), Record: record,
      ContactInput: object({ externalId: string, kind: { enum: ['customer', 'vendor'] }, name: string, email: string, termsDays: { type: 'integer', minimum: 0, maximum: 365 } }, ['externalId', 'kind', 'name']),
      BillInput: object({ vendorId: string, reference: string, billDate: day, dueDate: day, memo: string, className: string, post: bool, lines: array(object({ ...dimensionInputs,description: string, accountId: string, amount: decimal }, ['description', 'accountId', 'amount'])) }, ['vendorId', 'reference', 'billDate', 'lines']),
      InvoiceInput: object({ customerId: string, number: string, issueDate: day, dueDate: day, memo: string, templateId: string, customFields: { type: 'object', additionalProperties: string }, destinationState: string, kind: { enum: ['invoice', 'credit'] }, creditFor: string, post: bool, lines: array(invoiceLine),
        discounts: array(object({ type: { enum: ['percent', 'amount'] }, value: { type: 'string', description: 'Percentage or USD amount according to type.' }, lines: { oneOf: [array({ type: 'integer', minimum: 1 }), { const: 'subtotal' }, { type: 'null' }] }, afterTax: bool }, ['type', 'value'])),
        deposit: object({ amount: decimal, method: string, date: day, bankAccountId: string, reference: string }, ['amount', 'method', 'bankAccountId']),
        earlyPayment: object({ percent: { type: 'string', description: 'More than 0 and less than 100 percent, up to three decimals.' }, days: { type: 'integer', minimum: 1, description: 'Whole days after issue, no later than the due date.' } }, ['percent', 'days']),
      }, ['customerId', 'issueDate', 'lines']),
      JournalInput: object({ date: day, memo: string, post: bool, lines: array(object({ ...dimensionInputs,accountId: string, debit: decimal, credit: decimal, memo: string, contactId: string }, ['accountId'])) }, ['date', 'memo', 'lines']),
      DocumentInput: object({ name: string, mediaType: string, base64: { ...string, contentEncoding: 'base64', description: 'Original decoded file is 1 byte to 1,500,000 bytes; accepted media: application/pdf, image/png, image/jpeg, image/webp, text/plain, text/csv, application/x-ofx, application/ofx, application/vnd.intu.qbo.' }, linkedKind: { enum: ['bill', 'invoice', 'journal', 'payment', 'statement', 'none'] }, linkedId: string, note: string }, ['name', 'mediaType', 'base64']),
      PaymentInput: object({ direction: { enum: ['received', 'paid'] }, contactId: string, date: day, amount: decimal, bankAccountId: string, reference: string, method: { enum: ['unrecorded', 'check', 'ach', 'wire', 'cash', 'card', 'payment-network'], default: 'unrecorded' }, memo: string, post: { const: true }, allocations: array(allocation) }, ['direction', 'contactId', 'date', 'amount', 'bankAccountId']),
      VendorCredit: object({ class_name:string,location_name:string,project_name:string,id: string, vendor_id: string, reference: string, credit_date: day, amount_cents: { type: 'integer', minimum: 1 }, account_id: string, journal_id: string, created_by: string, created_at: string, write_off: { type: 'integer', enum: [0, 1] }, vendor_name: string, account_name: string, unallocated_cents: { type: 'integer', minimum: 0 }, allocations: array(ref('VendorCreditAllocation')) }, ['id', 'vendor_id', 'reference', 'credit_date', 'amount_cents', 'account_id', 'journal_id', 'unallocated_cents', 'allocations']),
      VendorCreditAllocation: object({ id: string, source_kind: { const: 'credit' }, source_id: string, target_kind: { const: 'bill' }, target_id: string, amount_cents: { type: 'integer', minimum: 1 }, allocation_date: day, created_by: string, created_at: string }, ['id', 'source_kind', 'source_id', 'target_kind', 'target_id', 'amount_cents', 'allocation_date', 'created_by', 'created_at']),
      VendorCreditInput: object({ ...dimensionInputs,vendorId: string, date: day, amount: decimal, reference: { ...string, maxLength: 80 }, accountId: { ...string, description: 'Original active expense or asset account; bank, receivable and payable accounts are refused.' }, allocations: array(allocation), post: { const: true } }, ['vendorId', 'date', 'amount', 'reference', 'accountId']),
      VendorCreditAllocationInput: object({ date: { ...day, description: 'Defaults to the credit date; cannot precede it.' }, allocations: { ...array(allocation), minItems: 1 }, post: { const: true } }, ['allocations']),
      ReadinessInput: object({ received: bool, readyToPay: bool }, ['received', 'readyToPay']),
    },
  },
}
