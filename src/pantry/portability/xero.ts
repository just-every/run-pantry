import { completeCoverage, dimensionBlock, documentSupported, journalIds, net, ownLines, sourceMappings, xeroLines } from './common'
import { amount } from './format'
import { block, emptyPlan, mapping, operation, ref, type Snapshot } from './types'

export function xeroPlan(s: Snapshot) {
  const plan = emptyPlan(), held = new Set<string>()
  sourceMappings(plan, s, 'xero')
  const path = (resource: string) => `/api.xro/2.0/${resource}`
  for (const a of s.accounts) {
    if (plan.mappings.some(m => m.key === `Account:${a.id}`)) continue
    const type: Record<string,string> = { asset: 'CURRENT', liability: 'CURRLIAB', equity: 'EQUITY', income: 'REVENUE', expense: 'OVERHEADS' }
    if (a.code.length > 10 || a.name.length > 150) { mapping(plan, `Account:${a.id}`, `Map ${a.code} ${a.name}: source code or name exceeds Xero's field length.`); continue }
    operation(plan, 'Account', a.id, path('Accounts'), { Accounts: [{ Code: a.code, Name: a.name, Type: type[a.type], Description: a.description, TaxType: 'NONE' }] }, 'Accounts.0.AccountID')
  }
  const names = new Map<string, number>()
  for (const c of s.contacts) names.set(c.name.toLowerCase(), (names.get(c.name.toLowerCase()) ?? 0) + 1)
  for (const c of s.contacts) {
    if (names.get(c.name.toLowerCase())! > 1) { mapping(plan, `Contact:${c.id}`, `Resolve the customer or vendor named ${c.name} to the correct existing Xero contact; do not create duplicate names.`); continue }
    operation(plan, 'Contact', c.id, path('Contacts'), { Contacts: [{ Name: c.name, ContactNumber: c.id, ...(c.email ? { EmailAddress: c.email } : {}), ...(c.phone ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] } : {}), ...(c.export_address ? { Addresses: [{ AddressType: 'POBOX', AddressLine1: c.export_address }] } : {}) }] }, 'Contacts.0.ContactID')
  }
  for (const i of s.items) {
    const code = i.sku || i.id
    if (code.length > 30 || i.name.length > 50) { mapping(plan, `ItemCode:${i.id}`, `Map source item ${i.name}: its code or name exceeds Xero's item limit.`); continue }
    operation(plan, 'Item', i.id, path('Items'), { Items: [{ Code: code, Name: i.name, Description: i.description, IsSold: true, IsPurchased: false, IsTrackedAsInventory: false, SalesDetails: { UnitPrice: amount(i.rate_cents), AccountCode: mapping(plan, `AccountCode:${i.income_account_id}`, 'Use the actual Xero income-account code returned from account creation or mapping.'), ...(i.tax_category === 'taxable' ? { TaxType: mapping(plan, `TaxType:${i.tax_code ?? i.id}`, 'Map the actual Xero sales-tax type with the same rate and liability account as this item.') } : { TaxType: 'NONE' }) } }] }, 'Items.0.ItemID')
  }
  for (const doc of s.invoices) {
    journalIds(s, doc).forEach(id => held.add(id))
    const credit = doc.kind === 'credit', resource = credit ? 'CreditNotes' : 'Invoices', type = credit ? 'CreditNote' : 'Invoice'
    if (!documentSupported(plan, s, doc, type)) continue
    const lines = s.invoiceLines.filter(l => l.invoice_id === doc.id)
    if (dimensionBlock(plan, `${type}:${doc.id}`, lines)) continue
    if (doc.discount_cents || doc.after_tax_discount_cents) { block(plan, `${type}:${doc.id}`, 'Discounts post to a separate source account. A destination discount-line mapping is required to preserve that account and tax treatment.'); continue }
    if (lines.reduce((n,l) => n + l.amount_cents + l.tax_cents, 0) !== doc.total_cents) { block(plan, `${type}:${doc.id}`, 'Invoice lines and tax do not equal the posted total.'); continue }
    const LineItems = lines.map(l => ({ Description: l.description, Quantity: l.quantity_milli / 1000, UnitAmount: amount(l.unit_cents), LineAmount: amount(l.amount_cents), AccountCode: mapping(plan, `AccountCode:${l.account_id}`, 'Map to the actual Xero account code.'), ...(l.item_id ? { ItemCode: mapping(plan, `ItemCode:${l.item_id}`, 'Use the actual Xero item Code returned from item creation or mapping.') } : {}), TaxType: l.tax_cents ? mapping(plan, `TaxType:${l.tax_code}`, 'Map the actual Xero tax type with matching rate and liability account.') : 'NONE', TaxAmount: amount(l.tax_cents) }))
    operation(plan, type, doc.id, path(resource), { [resource]: [{ Type: credit ? 'ACCRECCREDIT' : 'ACCREC', Contact: { ContactID: ref(`Contact:${doc.customer_id}`) }, Date: doc.issue_date, ...(credit ? { CreditNoteNumber: doc.number } : { InvoiceNumber: doc.number, DueDate: doc.due_date }), Reference: doc.memo, Status: 'AUTHORISED', CurrencyCode: s.entity.currency, LineAmountTypes: 'Exclusive', LineItems }] }, `${resource}.0.${credit ? 'CreditNoteID' : 'InvoiceID'}`, journalIds(s, doc))
  }
  for (const doc of s.bills) {
    journalIds(s, doc).forEach(id => held.add(id))
    if (!documentSupported(plan, s, doc, 'Bill')) continue
    const lines = s.billLines.filter(l => l.bill_id === doc.id)
    if (dimensionBlock(plan, `Bill:${doc.id}`, lines)) continue
    if (lines.reduce((n,l) => n + l.amount_cents, 0) !== doc.total_cents) { block(plan, `Bill:${doc.id}`, 'Bill lines do not equal its posted total.'); continue }
    operation(plan, 'Bill', doc.id, path('Invoices'), { Invoices: [{ Type: 'ACCPAY', Contact: { ContactID: ref(`Contact:${doc.vendor_id}`) }, Date: doc.bill_date, DueDate: doc.due_date, InvoiceNumber: doc.reference, Reference: doc.memo, Status: 'AUTHORISED', CurrencyCode: s.entity.currency, LineAmountTypes: 'NoTax', LineItems: xeroLines(plan, s, lines) }] }, 'Invoices.0.InvoiceID', journalIds(s, doc))
  }
  for (const credit of s.vendorCredits) {
    held.add(credit.journal_id)
    if (dimensionBlock(plan, `VendorCredit:${credit.id}`, ownLines(s, credit.journal_id))) continue
    operation(plan, 'VendorCredit', credit.id, path('CreditNotes'), { CreditNotes: [{ Type: 'ACCPAYCREDIT', Contact: { ContactID: ref(`Contact:${credit.vendor_id}`) }, Date: credit.credit_date, CreditNoteNumber: credit.reference, Status: 'AUTHORISED', LineAmountTypes: 'NoTax', LineItems: xeroLines(plan, s, [{ description: credit.reference, account_id: credit.account_id, amount_cents: credit.amount_cents }]) }] }, 'CreditNotes.0.CreditNoteID', [credit.journal_id])
  }
  for (const p of s.payments) {
    held.add(p.journal_id)
    const allocations = s.allocations.filter(a => a.source_kind === 'payment' && a.source_id === p.id), bank = s.banks.find(b => b.id === p.bank_account_id)!
    if (p.reversal_id && s.entries.some(e => e.id === p.reversal_id)) { block(plan, `Payment:${p.id}`, 'Reversed payments need native payment reversal lifecycle replay; source and reversal are both retained.'); continue }
    if (allocations.reduce((n,a) => n + a.amount_cents, 0) !== p.amount_cents) { block(plan, `Payment:${p.id}`, 'Unapplied payment requires a destination overpayment or prepayment resource and actual allocation lineage. No cash receipt or bill was invented.'); continue }
    for (const [index,a] of allocations.entries()) operation(plan, 'Payment', `${p.id}:${a.id}`, path('Payments'), { Payments: [{ Invoice: { InvoiceID: ref(`${a.target_kind === 'bill' ? 'Bill' : 'Invoice'}:${a.target_id}`) }, Account: { AccountID: ref(`Account:${bank.account_id}`) }, Date: p.payment_date, Amount: amount(a.amount_cents), Reference: p.reference }] }, 'Payments.0.PaymentID', index === 0 ? [p.journal_id] : [])
  }
  for (const a of s.allocations.filter(a => a.source_kind === 'credit')) {
    const type = a.target_kind === 'bill' ? 'VendorCredit' : 'CreditNote'
    operation(plan, 'Allocation', a.id, path(`CreditNotes/{ref:${type}:${a.source_id}}/Allocations`), { Allocations: [{ Invoice: { InvoiceID: ref(`${a.target_kind === 'bill' ? 'Bill' : 'Invoice'}:${a.target_id}`) }, Amount: amount(a.amount_cents), Date: a.allocation_date }] }, 'Allocations.0.AllocationID')
  }
  for (const e of s.entries) {
    if (held.has(e.id)) continue
    const lines = ownLines(s, e.id), bankLines = lines.filter(l => s.accounts.find(a => a.id === l.account_id)?.subtype === 'bank')
    if (dimensionBlock(plan, `Journal:${e.id}`, lines)) continue
    if (bankLines.length === 2 && lines.length === 2 && net(bankLines[0]) === -net(bankLines[1])) {
      const from = bankLines.find(l => net(l) < 0)!, to = bankLines.find(l => net(l) > 0)!
      operation(plan, 'Journal', e.id, path('BankTransfers'), { BankTransfers: [{ FromBankAccount: { AccountID: ref(`Account:${from.account_id}`) }, ToBankAccount: { AccountID: ref(`Account:${to.account_id}`) }, Date: e.entry_date, Amount: amount(net(to)) }] }, 'BankTransfers.0.BankTransferID', [e.id])
      continue
    }
    if (lines.some(l => ['receivable','payable','retained'].includes(s.accounts.find(a => a.id === l.account_id)!.subtype))) {
      block(plan, `Journal:${e.id}`, 'Xero prohibits manual journals to A\u002fR, A\u002fP and retained earnings. This source entry needs native document or conversion lifecycle mapping; it was not rewritten to a clearing account.')
      continue
    }
    if (bankLines.length === 1) {
      const bank = bankLines[0], others = lines.filter(l => l !== bank), receive = net(bank) > 0
      if (others.some(l => (receive ? -net(l) : net(l)) <= 0)) { block(plan, `Journal:${e.id}`, 'Mixed-sign bank split needs explicit destination resource mapping.'); continue }
      const contactIds = [...new Set(lines.map(l => l.contact_id).filter(Boolean))]
      if (contactIds.length > 1) { block(plan, `Journal:${e.id}`, 'Bank journal contains multiple contacts; native transaction splitting needs explicit mapping.'); continue }
      operation(plan, 'Journal', e.id, path('BankTransactions'), { BankTransactions: [{ Type: receive ? 'RECEIVE' : 'SPEND', BankAccount: { AccountID: ref(`Account:${bank.account_id}`) }, Contact: { ContactID: contactIds.length ? ref(`Contact:${contactIds[0]}`) : mapping(plan, `BankContact:${e.id}`, 'Select the real counterparty for this source bank transaction; the source has no contact and none is invented.') }, Date: e.entry_date, Reference: e.memo, Status: 'AUTHORISED', LineAmountTypes: 'NoTax', LineItems: xeroLines(plan, s, others, receive ? -1 : 1) }] }, 'BankTransactions.0.BankTransactionID', [e.id])
    } else if (bankLines.length) block(plan, `Journal:${e.id}`, 'Journal has multiple bank accounts and other splits; native bank-resource mapping is required.')
    else operation(plan, 'Journal', e.id, path('ManualJournals'), { ManualJournals: [{ Narration: e.memo, Date: e.entry_date, Status: 'POSTED', LineAmountTypes: 'NoTax', ShowOnCashBasisReports: true, JournalLines: lines.map(l => ({ Description: l.memo, LineAmount: amount(net(l)), AccountCode: mapping(plan, `AccountCode:${l.account_id}`, 'Map to the actual Xero account code.'), TaxType: 'NONE' })) }] }, 'ManualJournals.0.ManualJournalID', [e.id])
  }
  completeCoverage(plan, s)
  return plan
}
