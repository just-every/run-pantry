import type { Data } from '../core'
import { csv, csvNumber as decimal } from './format'
import type { Destination, Plan, Snapshot } from './types'

export type ExportFile = { name: string; data: string | Uint8Array }

export function recordFiles(s: Snapshot, destination: Destination, plan: Plan): ExportFile[] {
  const account = (id: string) => s.accounts.find(a => a.id === id)!, contact = (id: string) => s.contacts.find(c => c.id === id)!
  const journalIds = new Set(plan.operations.filter(op => /\/(journalentry|ManualJournals)$/.test(op.path)).flatMap(op => op.journalIds))
  const journalLines = s.lines.filter(l => journalIds.has(l.entry_id))
  const files: ExportFile[] = [], add = (name: string, rows: unknown[][]) => files.push({ name, data: csv(rows) })
  if (destination === 'qbo') {
    const types: Record<string,string> = { asset:'Other Current Asset', liability:'Other Current Liability', equity:'Equity', income:'Income', expense:'Expense' }
    add('qbo/chart-of-accounts.csv', [['Account Number','Account Name','Account Type'], ...s.accounts.map(a => [a.code,a.name,a.subtype === 'receivable' ? 'Accounts Receivable (A\u002fR)' : a.subtype === 'payable' ? 'Accounts Payable (A\u002fP)' : a.subtype === 'bank' ? a.type === 'liability' ? 'Credit Card' : 'Bank' : types[a.type]])])
    for (const kind of ['customer','vendor']) add(`qbo/${kind}s.csv`, [['Name','Email','Phone','Address'], ...s.contacts.filter(c => c.kind === kind).map(c => [c.name,c.email,c.phone,c.export_address])])
    add('qbo/products-and-services.csv', [['Product\u002fService Name','Sales Description','SKU','Type','Sales Price\u002fRate','Income Account'], ...s.items.map(i => [i.name,i.description,i.sku,i.kind === 'service' ? 'Service' : 'NonInventory',decimal(i.rate_cents),account(i.income_account_id).name])])
    add('qbo/journals.csv', [['Journal No.','Journal Date','Account Name','Description','Debits','Credits','Name'], ...journalLines.map(l => {
      const e = s.entries.find(e => e.id === l.entry_id)!
      return [e.number ?? e.id,e.entry_date,account(l.account_id).name,l.memo || e.memo,l.debit_cents ? decimal(l.debit_cents) : '',l.credit_cents ? decimal(l.credit_cents) : '',l.contact_id ? contact(l.contact_id).name : '']
    })])
  } else {
    const types: Record<string,string> = { asset:'Current Asset', liability:'Current Liability', equity:'Equity', income:'Revenue', expense:'Overhead' }
    add('xero/chart-of-accounts.csv', [['Code','Name','Type','Tax Code','Description','Balance'], ...s.accounts.map(a => [a.code,a.name,a.subtype === 'bank' ? a.type === 'liability' ? 'Credit Card' : 'Bank' : types[a.type],'No Tax',a.subtype === 'bank' ? '' : a.description,''])])
    add('xero/contacts.csv', [['ContactName','EmailAddress','PhoneNumber','POAddressLine1'], ...s.contacts.map(c => [c.name,c.email,c.phone,c.export_address])])
    add('xero/items.csv', [['ItemCode','ItemName','SalesDescription','SalesUnitPrice','SalesAccount','SalesTaxRate'], ...s.items.map(i => [i.sku || i.id,i.name,i.description,decimal(i.rate_cents),account(i.income_account_id).code,i.tax_category === 'taxable' ? '' : 'No Tax'])])
    add('xero/journals.csv', [['Narration','Date','Description','AccountCode','TaxRate','Amount','TrackingName1','TrackingOption1','TrackingName2','TrackingOption2'], ...journalLines.map(l => {
      const e = s.entries.find(e => e.id === l.entry_id)!
      return [e.memo,e.entry_date,l.memo,account(l.account_id).code,'No Tax',decimal(l.debit_cents-l.credit_cents),'','','','']
    })])
  }
  // Open-document files preserve original lines and original totals, never prorated made-up invoice lines.
  // Payments and credit allocations are in transport and source files and must be replayed to reach the open amounts.
  const supported = new Set(plan.operations.map(op => op.key))
  const openInvoiceIds = new Set(s.receivables.items.filter((i: Data) => supported.has(`Invoice:${i.id}`)).map((i: Data) => i.id)), openBillIds = new Set(s.payables.items.filter((i: Data) => supported.has(`Bill:${i.id}`)).map((i: Data) => i.id))
  if (destination === 'qbo') {
    add('qbo/open-invoices.csv', [['Invoice No.','Customer','Invoice Date','Due Date','Item (Product\u002fService)','Item Description','Item Quantity','Item Rate','Item Amount'], ...s.invoiceLines.filter(l => openInvoiceIds.has(l.invoice_id)).map(l => {
      const i = s.invoices.find(i => i.id === l.invoice_id)!
      return [i.number,contact(i.customer_id).name,i.issue_date,i.due_date,s.items.find(i => i.id === l.item_id)?.name ?? '',l.description,decimal(l.quantity_milli,3),decimal(l.unit_cents),decimal(l.amount_cents)]
    })])
    add('qbo/open-bills.csv', [['Bill No.','Supplier','Bill Date','Due Date','Account','Line Description','Line Amount'], ...s.billLines.filter(l => openBillIds.has(l.bill_id)).map(l => {
      const b = s.bills.find(b => b.id === l.bill_id)!
      return [b.reference,contact(b.vendor_id).name,b.bill_date,b.due_date,account(l.account_id).name,l.description,decimal(l.amount_cents)]
    })])
  } else {
    const headers = ['ContactName','InvoiceNumber','InvoiceDate','DueDate','Description','Quantity','UnitAmount','AccountCode','TaxType','TaxAmount','Currency']
    add('xero/open-invoices.csv', [headers, ...s.invoiceLines.filter(l => openInvoiceIds.has(l.invoice_id)).map(l => {
      const i = s.invoices.find(i => i.id === l.invoice_id)!
      return [contact(i.customer_id).name,i.number,i.issue_date,i.due_date,l.description,decimal(l.quantity_milli,3),decimal(l.unit_cents),account(l.account_id).code,l.tax_cents ? '' : 'No Tax',decimal(l.tax_cents),s.entity.currency]
    })])
    add('xero/open-bills.csv', [headers, ...s.billLines.filter(l => openBillIds.has(l.bill_id)).map(l => {
      const b = s.bills.find(b => b.id === l.bill_id)!
      return [contact(b.vendor_id).name,b.reference,b.bill_date,b.due_date,l.description,1,decimal(l.amount_cents),account(l.account_id).code,'No Tax','0.00',s.entity.currency]
    })])
  }
  add('review/open-balances.csv', [['Kind','Source ID','Contact','Reference','Original total','Remaining at export'], ...[['invoice',s.receivables],['bill',s.payables]].flatMap(([kind,r]) => (r as Data).items.map((i: Data) => [kind,i.id,i.contact,i.ref,decimal(i.total_cents),decimal(i.open)]))])
  for (const [label,tb] of [['opening',s.opening],['closing',s.closing]] as const) add(`review/${label}-trial-balance.csv`, [['Account code','Account','Debit','Credit'], ...tb.rows.map((r:Data) => [r.code,r.name,decimal(r.debitBalance),decimal(r.creditBalance)]),['','Total',decimal(tb.debit),decimal(tb.credit)]])
  const source = { accounts:s.accounts, contacts:s.contacts, items:s.items, postedEntries:s.entries, postedLines:s.lines, invoices:s.invoices, invoiceLines:s.invoiceLines, bills:s.bills, billLines:s.billLines, payments:s.payments, vendorCredits:s.vendorCredits, allocations:s.allocations }
  for (const [key,value] of Object.entries(source)) files.push({ name:`source/${key}.json`, data:JSON.stringify(value,null,2) })
  return files
}
