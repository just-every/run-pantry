// The two move-in kits as the page offers them: each export, where to find it
// in the old system, and how the page names what was counted.
export type SourceKey = 'quickbooks-online' | 'xero'
export type SourceUi = { key: SourceKey; name: string; files: [string, string, string][]; intro: string; bankName: string }

export const SOURCES: SourceUi[] = [
  { key: 'quickbooks-online', name: 'QuickBooks Online', bankName: 'QuickBooks account name',
    intro: 'Run each report in QuickBooks Online for the cutover date, export it unchanged and save it as CSV. Attachments export separately; upload source documents in Documents afterwards.',
    files: [
      ['accounts', 'Account List', 'Reports → Account List'],
      ['customers', 'Customer Contact List', 'Reports → Customer Contact List'],
      ['vendors', 'Vendor Contact List', 'Reports → Vendor Contact List'],
      ['trialBalance', 'Trial Balance', 'As of the cutover date, accountant-approved'],
      ['openInvoices', 'Open Invoices', 'As of the cutover date'],
      ['unpaidBills', 'Unpaid Bills', 'As of the cutover date'],
      ['generalLedger', 'General Ledger', 'The history you want kept read-only'],
    ] },
  { key: 'xero', name: 'Xero', bankName: 'Xero account name',
    intro: 'Export each list from Xero as CSV, and each report to Excel, then save its sheet as CSV. Export on the cutover date, before recording anything later. Xero’s exports carry no files; after importing, connect Xero to carry attachments over.',
    files: [
      ['accounts', 'Chart of accounts', 'Accounting → Chart of accounts → Export'],
      ['contacts', 'Contacts', 'Contacts → All contacts → Export'],
      ['trialBalance', 'Trial Balance', 'Reports → Trial Balance, as at the cutover date'],
      ['invoices', 'Sales invoices', 'Sales → Invoices → All → Export'],
      ['bills', 'Bills', 'Purchases → Bills → All → Export'],
      ['bankTransactions', 'Account Transactions', 'Reports → Account Transactions: your bank accounts, to the cutover date'],
    ] },
]
export const sourceName = (key: string) => SOURCES.find(s => s.key === key)?.name ?? key

export const COUNT_LABEL: Record<string, string> = { accounts: 'Accounts', customers: 'Customers', vendors: 'Vendors', bankAccounts: 'Bank accounts', trialBalance: 'Trial balance rows', openInvoices: 'Open invoices', unpaidBills: 'Unpaid bills', historyLines: 'History lines' }
