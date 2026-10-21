// API-001: the implemented scoped transport, not the larger target contract.
// Schemas describe wire values; native parsers still enforce accounting rules.
import { INTEGRATION_REQUESTS_PER_MINUTE } from './rate-limit'

type Schema = Record<string, unknown>
const string = { type: 'string' }
const day = { type: 'string', format: 'date' }
const decimal = { type: 'string', description: 'Decimal input in USD (quantities and rates also use decimal strings).' }
const bool = { type: 'boolean' }
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
const invoiceLine = object({ itemId: string, kind: { enum: ['item', 'delivery'] }, description: string, quantity: decimal, rate: decimal, accountId: string, taxCode: { ...string, description: 'Tax-code ID or exempt. Required for issuing; omitted fields may use an item default.' } })
const allocation = object({ targetId: string, amount: decimal }, ['targetId', 'amount'])
const paths: Record<string, unknown> = {
  '/openapi.json': { get: operation('getOpenApi', 'Read this implemented v1 API description', [], object({}), [], undefined, 'Uses the same valid integration credential as the other routes. Contains no installation records or secrets.') },
  '/state': { get: operation('getState', 'Read account and tax-code mappings', ['any record scope'], object({ accounts: array(object({})), taxCodes: array(object({})), bankAccounts: array(object({})), contacts: array(ref('Record')), nextCursor: { type: ['string', 'null'] } }), [...paging, query('id'), query('name')], undefined, 'Contacts and their cursor appear only with contacts:write. Bank-account mappings appear only with payments:read or payments:write. This route creates no accounts.') },
}
for (const spec of [
  { path: 'contacts', scope: 'contacts:write', key: 'contacts', filters: ['id', 'name'], body: 'ContactInput' },
  { path: 'bills', scope: 'bills:write', key: 'bills', filters: ['id', 'reference'], body: 'BillInput' },
  { path: 'invoices', scope: 'invoices:write', key: 'invoices', filters: ['id', 'number'], body: 'InvoiceInput' },
  { path: 'journals', scope: 'journals:write', key: 'entries', filters: ['id', 'memo'], body: 'JournalInput' },
  { path: 'documents', scope: 'documents:write', key: 'documents', filters: ['id', 'name', 'linkedId'], body: 'DocumentInput' },
  { path: 'payments', scope: 'payments:write', key: 'payments', filters: ['id', 'reference', 'billId', 'invoiceId'], body: 'PaymentInput' },
]) paths[`/${spec.path}`] = {
  get: operation(`list${spec.path}`, `Read ${spec.path}`, spec.path === 'payments' ? ['payments:read OR payments:write'] : [spec.scope], list(spec.key), [...paging, ...spec.filters.map(name => query(name, string, name === 'billId' || name === 'invoiceId' ? 'Exact allocation target. billId takes precedence if both are supplied.' : 'Exact whole-value match.'))]),
  post: operation(`create${spec.path}`, `Create ${spec.path}`, [spec.scope], ref('Record'), [key], spec.body, spec.path === 'payments' ? 'Also requires post; records money already moved, never initiates a transfer. post:false is refused.' : 'Bills, invoices and journals stay drafts unless post:true is supplied with the separate post scope. Native approvals, current invoice terms and period-lock checks apply.'),
}
paths['/documents/{id}'] = { get: { ...operation('downloadDocument', 'Download original document bytes', ['documents:write'], {}, [id]), responses: { 200: { description: 'Original bytes with the stored media type and attachment filename.', headers: rateHeaders, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, ...errors } } }
paths['/bills/{id}/readiness'] = { post: operation('setBillReadiness', 'Record receipt and readiness of a posted bill', ['bills:write'], ref('Record'), [id, key], 'ReadinessInput', 'Both booleans are required. Ready requires received. This creates no payment; native period locks apply.') }
paths['/reports/trial-balance'] = { get: operation('getTrialBalance', 'Read the trial balance on the chosen basis', ['reports:read'], object({ basis: { enum: ['cash', 'accrual'] }, rows: array(object({})) }), [query('to', day, 'Inclusive end date; defaults to today in UTC.'), query('basis', { enum: ['cash', 'accrual'] }, 'Defaults to the declared tax method, or accrual when undeclared. An explicit choice wins.')]) }

export const integrationOpenApi = {
  openapi: '3.1.0',
  info: { title: 'Pantry scoped integration API', version: '1.0.0', description: 'Implemented API-001 subset. Record responses retain native fields, including integer cents. Wider record coverage and signed outbound event webhooks with retry/delivery history remain unimplemented. No OAuth, money-movement or production-provider acceptance is implied.' },
  servers: [{ url: '/api/pantry/integration/v1', description: 'This Pantry installation' }],
  security: [{ integrationBearer: [] }], paths,
  'x-pantry-rate-limit': { requests: INTEGRATION_REQUESTS_PER_MINUTE, windowSeconds: 60, scope: 'credential', window: 'fixed UTC minute', description: 'Every valid, non-revoked credential request counts, including discovery, replays, refused scopes, invalid bodies and unknown routes. Excess requests return 429 without domain work and do not extend the window. Missing, invalid and revoked credentials return 401 before quota admission.' },
  components: {
    securitySchemes: { integrationBearer: { type: 'http', scheme: 'bearer', description: 'Owner-issued pantry_integration_ credential. Not a native session or proposal-only agent token. Scope requirements are listed per operation in x-pantry-scopes; post is an additional grant.' } },
    schemas: {
      Error: object({ error: string }, ['error']), Record: record,
      ContactInput: object({ externalId: string, kind: { enum: ['customer', 'vendor'] }, name: string, email: string, termsDays: { type: 'integer', minimum: 0, maximum: 365 } }, ['externalId', 'kind', 'name']),
      BillInput: object({ vendorId: string, reference: string, billDate: day, dueDate: day, memo: string, className: string, post: bool, lines: array(object({ description: string, accountId: string, amount: decimal }, ['description', 'accountId', 'amount'])) }, ['vendorId', 'reference', 'billDate', 'lines']),
      InvoiceInput: object({ customerId: string, number: string, issueDate: day, dueDate: day, memo: string, templateId: string, customFields: { type: 'object', additionalProperties: string }, destinationState: string, kind: { enum: ['invoice', 'credit'] }, creditFor: string, post: bool, lines: array(invoiceLine),
        discounts: array(object({ type: { enum: ['percent', 'amount'] }, value: { type: 'string', description: 'Percentage or USD amount according to type.' }, lines: { oneOf: [array({ type: 'integer', minimum: 1 }), { const: 'subtotal' }, { type: 'null' }] }, afterTax: bool }, ['type', 'value'])),
        deposit: object({ amount: decimal, method: string, date: day, bankAccountId: string, reference: string }, ['amount', 'method', 'bankAccountId']),
        earlyPayment: object({ percent: { type: 'string', description: 'More than 0 and less than 100 percent, up to three decimals.' }, days: { type: 'integer', minimum: 1, description: 'Whole days after issue, no later than the due date.' } }, ['percent', 'days']),
      }, ['customerId', 'issueDate', 'lines']),
      JournalInput: object({ date: day, memo: string, post: bool, lines: array(object({ accountId: string, debit: decimal, credit: decimal, memo: string, contactId: string }, ['accountId'])) }, ['date', 'memo', 'lines']),
      DocumentInput: object({ name: string, mediaType: string, base64: { ...string, contentEncoding: 'base64', description: 'Original decoded file is 1 byte to 1,500,000 bytes; accepted media: application/pdf, image/png, image/jpeg, image/webp, text/plain, text/csv, application/x-ofx, application/ofx, application/vnd.intu.qbo.' }, linkedKind: { enum: ['bill', 'invoice', 'journal', 'payment', 'statement', 'none'] }, linkedId: string, note: string }, ['name', 'mediaType', 'base64']),
      PaymentInput: object({ direction: { enum: ['received', 'paid'] }, contactId: string, date: day, amount: decimal, bankAccountId: string, reference: string, method: { enum: ['unrecorded', 'check', 'ach', 'wire', 'cash', 'card', 'payment-network'], default: 'unrecorded' }, memo: string, post: { const: true }, allocations: array(allocation) }, ['direction', 'contactId', 'date', 'amount', 'bankAccountId']),
      ReadinessInput: object({ received: bool, readyToPay: bool }, ['received', 'readyToPay']),
    },
  },
}
