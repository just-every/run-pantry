import type { Data } from '../core'
import { completeCoverage, dimensionBlock, documentSupported, journalIds, ownLines, sourceMappings } from './common'
import { amount } from './format'
import { block, emptyPlan, mapping, operation, ref, type Snapshot } from './types'

/** Native resources represent document journals once; remaining posted journals use JournalEntry. */
export function qboPlan(s: Snapshot) {
  const plan = emptyPlan(), held = new Set<string>()
  sourceMappings(plan, s, 'qbo')
  const path = (resource: string) => `/v3/company/{realmId}/${resource.toLowerCase()}`
  for (const a of s.accounts) {
    if (plan.mappings.some(m => m.key === `Account:${a.id}`)) continue
    const type: Record<string,string> = { asset: 'Other Current Asset', liability: 'Other Current Liability', equity: 'Equity', income: 'Income', expense: 'Expense' }
    operation(plan, 'Account', a.id, path('account'), { Name: a.name, AcctNum: a.code, AccountType: type[a.type], ...(a.type === 'equity' ? { AccountSubType: mapping(plan, `EquityDetail:${a.id}`, `Select the actual non-system QBO equity detail type for ${a.code} ${a.name}; do not create another opening-balance system account.`) } : {}), Description: a.description }, 'Account.Id')
  }
  const names = new Map<string, number>()
  for (const c of s.contacts) names.set(c.name.toLowerCase(), (names.get(c.name.toLowerCase()) ?? 0) + 1)
  for (const c of s.contacts) {
    const type = c.kind === 'customer' ? 'Customer' : 'Vendor', key = `${type}:${c.id}`
    if (names.get(c.name.toLowerCase())! > 1) { mapping(plan, key, `Resolve duplicate QBO display name ${c.name} against the actual destination contact.`); continue }
    operation(plan, type, c.id, path(type), { DisplayName: c.name, ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}), ...(c.phone ? { PrimaryPhone: { FreeFormNumber: c.phone } } : {}), ...(c.export_address ? { BillAddr: { Line1: c.export_address } } : {}) }, `${type}.Id`)
  }
  for (const i of s.items) operation(plan, 'Item', i.id, path('item'), { Name: i.name, Type: i.kind === 'service' ? 'Service' : 'NonInventory', ...(i.sku ? { Sku: i.sku } : {}), Description: i.description, UnitPrice: amount(i.rate_cents), IncomeAccountRef: { value: ref(`Account:${i.income_account_id}`) }, Taxable: i.tax_category === 'taxable' }, 'Item.Id')
  for (const doc of s.invoices) {
    journalIds(s, doc).forEach(id => held.add(id))
    const type = doc.kind === 'credit' ? 'CreditMemo' : 'Invoice', source = `${type}:${doc.id}`
    if (!documentSupported(plan, s, doc, type)) continue
    const lines = s.invoiceLines.filter(l => l.invoice_id === doc.id)
    if (dimensionBlock(plan, source, lines)) continue
    if (doc.tax_cents || doc.discount_cents || doc.after_tax_discount_cents) { block(plan, source, 'Tax and discount postings require QBO tax-service and discount-account mappings; no tax or discount amounts were silently changed.'); continue }
    if (lines.reduce((n,l) => n + l.amount_cents, 0) !== doc.total_cents) { block(plan, source, 'Invoice line total differs from the recorded posted total.'); continue }
    const payload: Data = { DocNumber: doc.number, TxnDate: doc.issue_date, ...(type === 'Invoice' ? { DueDate: doc.due_date } : {}), CustomerRef: { value: ref(`Customer:${doc.customer_id}`) }, PrivateNote: doc.memo, Line: lines.map(l => ({ DetailType: 'SalesItemLineDetail', Description: l.description, Amount: amount(l.amount_cents), SalesItemLineDetail: { ItemRef: { value: l.item_id ? ref(`Item:${l.item_id}`) : mapping(plan, `SalesItem:${l.account_id}`, 'Select an existing QBO product or service with this exact income account for source invoice lines without an item; Pantry does not invent one.') }, Qty: l.quantity_milli / 1000, UnitPrice: amount(l.unit_cents), TaxCodeRef: { value: 'NON' } } })) }
    operation(plan, type, doc.id, path(type), payload, `${type}.Id`, journalIds(s, doc))
  }
  for (const doc of s.bills) {
    journalIds(s, doc).forEach(id => held.add(id))
    if (!documentSupported(plan, s, doc, 'Bill')) continue
    const lines = s.billLines.filter(l => l.bill_id === doc.id)
    if (dimensionBlock(plan, `Bill:${doc.id}`, lines)) continue
    if (lines.reduce((n,l) => n + l.amount_cents, 0) !== doc.total_cents) { block(plan, `Bill:${doc.id}`, 'Bill lines do not equal its posted total.'); continue }
    operation(plan, 'Bill', doc.id, path('bill'), { DocNumber: doc.reference, TxnDate: doc.bill_date, DueDate: doc.due_date, VendorRef: { value: ref(`Vendor:${doc.vendor_id}`) }, PrivateNote: doc.memo, Line: lines.map(l => ({ DetailType: 'AccountBasedExpenseLineDetail', Description: l.description, Amount: amount(l.amount_cents), AccountBasedExpenseLineDetail: { AccountRef: { value: ref(`Account:${l.account_id}`) } } })) }, 'Bill.Id', journalIds(s, doc))
  }
  for (const credit of s.vendorCredits) {
    held.add(credit.journal_id)
    if (dimensionBlock(plan, `VendorCredit:${credit.id}`, ownLines(s, credit.journal_id))) continue
    operation(plan, 'VendorCredit', credit.id, path('vendorcredit'), { DocNumber: credit.reference, TxnDate: credit.credit_date, VendorRef: { value: ref(`Vendor:${credit.vendor_id}`) }, Line: [{ DetailType: 'AccountBasedExpenseLineDetail', Amount: amount(credit.amount_cents), AccountBasedExpenseLineDetail: { AccountRef: { value: ref(`Account:${credit.account_id}`) } } }] }, 'VendorCredit.Id', [credit.journal_id])
  }
  for (const p of s.payments) {
    held.add(p.journal_id)
    const source = `Payment:${p.id}`, allocations = s.allocations.filter(a => a.source_kind === 'payment' && a.source_id === p.id)
    if (p.reversal_id && s.entries.some(e => e.id === p.reversal_id)) { block(plan, source, 'Payment reversal needs native destination payment deletion or reversal lifecycle replay.'); continue }
    const bank = s.banks.find(b => b.id === p.bank_account_id)!
    if (p.direction === 'received') operation(plan, 'Payment', p.id, path('payment'), {
      TxnDate: p.payment_date, TotalAmt: amount(p.amount_cents), CustomerRef: { value: ref(`Customer:${p.contact_id}`) }, DepositToAccountRef: { value: ref(`Account:${bank.account_id}`) }, PaymentRefNum: p.reference, PrivateNote: p.memo,
      Line: allocations.map(a => ({ Amount: amount(a.amount_cents), LinkedTxn: [{ TxnId: ref(`Invoice:${a.target_id}`), TxnType: 'Invoice' }] })),
    }, 'Payment.Id', [p.journal_id])
    else {
      if (allocations.reduce((n,a) => n + a.amount_cents, 0) !== p.amount_cents) { block(plan, source, 'Unapplied vendor payment cannot be converted to a BillPayment without inventing a bill.'); continue }
      if (s.accounts.find(a => a.id === bank.account_id)?.type === 'liability') { block(plan, source, 'Card bill payments require explicit QBO CreditCardPayment instrument mapping.'); continue }
      operation(plan, 'BillPayment', p.id, path('billpayment'), { TxnDate: p.payment_date, TotalAmt: amount(p.amount_cents), VendorRef: { value: ref(`Vendor:${p.contact_id}`) }, PayType: 'Check', CheckPayment: { BankAccountRef: { value: ref(`Account:${bank.account_id}`) }, PrintStatus: 'NotSet' }, PrivateNote: p.memo, Line: allocations.map(a => ({ Amount: amount(a.amount_cents), LinkedTxn: [{ TxnId: ref(`Bill:${a.target_id}`), TxnType: 'Bill' }] })) }, 'BillPayment.Id', [p.journal_id])
    }
  }
  for (const a of s.allocations.filter(a => a.source_kind === 'credit')) block(plan, `Allocation:${a.id}`, 'QBO credit application needs an explicit zero-cash credit-to-document linking operation. The original allocation is retained; do not import as a new cash payment.')
  for (const e of s.entries) {
    if (held.has(e.id)) continue
    const lines = ownLines(s, e.id)
    if (dimensionBlock(plan, `Journal:${e.id}`, lines)) continue
    const missing = lines.find(l => ['receivable','payable'].includes(s.accounts.find(a => a.id === l.account_id)!.subtype) && !l.contact_id)
    if (missing) { block(plan, `Journal:${e.id}`, 'QBO requires a customer or vendor on each A\u002fR or A\u002fP journal line; the source line has none.'); continue }
    operation(plan, 'Journal', e.id, path('journalentry'), { TxnDate: e.entry_date, ...(e.number === null ? {} : { DocNumber: String(e.number) }), PrivateNote: e.memo, Line: lines.map(l => {
      const c = s.contacts.find(c => c.id === l.contact_id), type = c?.kind === 'customer' ? 'Customer' : 'Vendor'
      return { Description: l.memo, Amount: amount(l.debit_cents || l.credit_cents), DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail: { PostingType: l.debit_cents ? 'Debit' : 'Credit', AccountRef: { value: ref(`Account:${l.account_id}`) }, ...(c ? { Entity: { Type: type, EntityRef: { value: ref(`${type}:${c.id}`) } } } : {}) } }
    }) }, 'JournalEntry.Id', [e.id])
  }
  completeCoverage(plan, s)
  return plan
}
