import { requireThat, text, type Data } from '../core'

export const SHEET_FIELDS = {
  accounts: ['externalId', 'name', 'code', 'type', 'subtype', 'description'],
  customers: ['externalId', 'name', 'email', 'termsDays'],
  vendors: ['externalId', 'name', 'email', 'termsDays'],
  items: ['externalId', 'name', 'kind', 'sku', 'description', 'rate', 'account', 'taxDecision', 'taxCode'],
  openInvoices: ['externalId', 'number', 'party', 'date', 'due', 'open', 'original', 'account', 'taxDecision'],
  unpaidBills: ['externalId', 'number', 'party', 'date', 'due', 'open', 'original', 'account', 'taxDecision'],
  trialBalance: ['account', 'debit', 'credit', 'className', 'locationName', 'projectName'],
} as const
export type Dataset = keyof typeof SHEET_FIELDS
export type Columns = Record<string, string>
export type SheetMappings = Partial<Record<Dataset, Columns>>
export const SHEET_LABELS: Record<Dataset, string> = { accounts: 'Chart of accounts', customers: 'Customers', vendors: 'Vendors', items: 'Items', openInvoices: 'Open invoices', unpaidBills: 'Open bills', trialBalance: 'Opening trial balance' }
export const DATASETS = Object.keys(SHEET_FIELDS) as Dataset[]
const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ALIASES: Record<string, string[]> = { externalId: ['external id', 'id'], name: ['name', 'full name'], email: ['email', 'email address'], number: ['number', 'reference', 'invoice number', 'bill number'], party: ['party', 'customer', 'vendor', 'contact'], open: ['open', 'open balance', 'amount due'], original: ['original', 'original amount'], date: ['date', 'issue date', 'bill date'], due: ['due', 'due date'], account: ['account', 'account name', 'income account'], rate: ['rate', 'price'], taxDecision: ['tax decision', 'tax category'], termsDays: ['terms days', 'terms'] }
export function dataset(value: unknown): Dataset { const key = text(value, 'List'); requireThat(DATASETS.includes(key as Dataset), 'Choose a spreadsheet list'); return key as Dataset }
export function columns(key: Dataset, input: unknown): Columns {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'Column mapping must be an object')
  const result: Columns = {}
  for (const [field, header] of Object.entries(input)) {
    requireThat((SHEET_FIELDS[key] as readonly string[]).includes(field), `Unknown ${key} field ${field}`)
    requireThat(typeof header === 'string' && header.length <= 200, 'Choose a column header')
    result[field] = header
  }
  requireThat(new Set(Object.values(result).filter(Boolean)).size === Object.values(result).filter(Boolean).length, 'Map each spreadsheet column to only one field')
  return result
}
export function suggest(key: Dataset, headers: string[], saved?: Columns): Columns {
  if (saved) return Object.fromEntries(Object.entries(saved).map(([field, header]) => [field, headers.includes(header) ? header : '']))
  return Object.fromEntries(SHEET_FIELDS[key].map(field => [field, headers.find(h => (ALIASES[field] ?? [field]).some(a => normal(a) === normal(h))) ?? '']).filter(([, h]) => h))
}

const EXAMPLES: Record<Dataset, string[]> = {
  accounts: ['synthetic-pantry-1', 'Consulting income', '4000', 'income', 'other', 'Consulting services'],
  customers: ['synthetic-pantry-1', 'Customer One', 'customer@example.test', '30'],
  vendors: ['synthetic-pantry-1', 'Vendor One', 'vendor@example.test', '30'],
  items: ['synthetic-pantry-1', 'Consulting', 'service', '', 'Hourly advice', '150.00', 'Consulting income', 'non-taxable', ''],
  openInvoices: ['synthetic-pantry-1', 'INV-1', 'Customer One', '2026-08-01', '2026-08-31', '100.00', '100.00', 'Accounts receivable', 'included'],
  unpaidBills: ['synthetic-pantry-1', 'BILL-1', 'Vendor One', '2026-08-01', '2026-08-31', '75.00', '75.00', 'Accounts payable', 'included'],
  trialBalance: ['Accounts receivable', '100.00', '0.00', '', '', ''],
}
export const spreadsheetTemplate = (key: Dataset): Data => ({ name: `${key}-template.csv`, contentType: 'text/csv;charset=utf-8', content: SHEET_FIELDS[key].join(',') + '\r\n' + EXAMPLES[key].join(',') + '\r\n' })
