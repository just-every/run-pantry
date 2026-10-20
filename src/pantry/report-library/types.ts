export type LibraryRow = { id: string; cells: (string | number)[]; record?: string; href?: string; details?: unknown }
export type LibraryReport = { kind: string; title: string; basis: string; basisLabel: string; from: string; to: string; note: string; columns: string[]; moneyColumns: number[]; rows: LibraryRow[]; totals: { label: string; amount: number }[] }
export const LIBRARY = {
  'receivables-summary': 'Receivables aging summary', 'payables-summary': 'Payables aging summary', 'open-invoices': 'Open invoices', 'unpaid-bills': 'Unpaid bills',
  'customer-balances': 'Customer balances', 'vendor-balances': 'Vendor balances', transactions: 'Transactions', journal: 'Journal', deposits: 'Deposit detail', 'check-detail': 'Check detail',
  reconciliations: 'Reconciliation reports', 'audit-log': 'Audit log', 'contractor-summary': '1099 summary',
} as const
export const isLibrary = (kind: string): kind is keyof typeof LIBRARY => Object.hasOwn(LIBRARY, kind)
