// Activity in words: what each recorded action and approval means to a person.
import { monthName } from './kit'

const ACTIONS: Record<string, string> = {
  'account.create': 'Added an account', 'account.update': 'Changed an account',
  'agent.create': 'Created an agent token', 'agent.deactivate': 'Turned off an agent token',
  'bank-account.create': 'Added a bank account', 'bank-account.correct-opening': 'Corrected a bank opening balance',
  'bank-rule.create': 'Made a bank rule', 'bank-rule.edit': 'Changed a bank rule', 'bank-rule.retire': 'Retired a bank rule', 'bank-rule.file': 'Filed by bank rule', 'bank-rule.undo': 'Undid a line filed by rule',
  'bill.draft': 'Drafted a bill', 'bill.edit': 'Changed a bill draft', 'bill.approve': 'Approved a bill', 'bill.record': 'Recorded a bill', 'bill.evidence-waived': "Waived a bill's receipt",
  'books-agent.run': 'Pantry checked the books', 'books-agent.settings': "Changed Pantry's questions and emails",
  'chart.start': 'Started the chart of accounts',
  'close.tasks': 'Added review tasks', 'close.task-done': 'Finished a review task', 'close.task-reopened': 'Reopened a review task',
  'contact.create': 'Added a customer or vendor', 'contact.update': 'Changed a customer or vendor',
  'contractor.save': "Changed a contractor's 1099 details", 'contractor.1099-csv': 'Downloaded the 1099 file',
  'credit.draft': 'Drafted a credit note', 'credit.edit': 'Changed a credit note draft', 'credit.approve': 'Approved a credit note', 'credit.issue': 'Issued a credit note',
  'document.upload': 'Uploaded a document',
  'entity.create': 'Set up the business', 'entity.update': 'Changed the business details',
  'feed.connect': 'Connected a bank or card', 'feed.map': 'Chose where bank feed accounts go', 'feed.relink': 'Re-linked a bank or card', 'feed.disconnect': 'Disconnected a bank or card',
  'gusto.connect': 'Connected Gusto', 'gusto.settings': 'Changed Gusto payroll settings', 'gusto.payroll': 'Booked a Gusto payroll', 'gusto.disconnect': 'Disconnected Gusto',
  'invoice.draft': 'Drafted an invoice', 'invoice.edit': 'Changed an invoice draft', 'invoice.approve': 'Approved an invoice', 'invoice.issue': 'Issued an invoice',
  'invoice.send': 'Sent an invoice', 'invoice.remind': 'Sent a payment reminder', 'invoice.viewed': 'Opened the invoice link', 'invoice.reminders-paused': "Paused an invoice's reminders", 'invoice.reminders-resumed': "Resumed an invoice's reminders",
  'recurring.create': 'Set up a recurring invoice', 'recurring.edit': 'Changed a recurring invoice', 'recurring.approve': 'Approved a recurring invoice', 'recurring.run': 'Created a recurring invoice', 'recurring.failed': 'A recurring invoice could not be created',
  'recurring.pause': 'Paused a recurring invoice', 'recurring.resume': 'Resumed a recurring invoice', 'recurring.end': 'Ended a recurring invoice',
  'sending.update': 'Changed invoice sending and reminders',
  'stripe.connect': 'Connected Stripe', 'stripe.methods': 'Changed online payment methods', 'stripe.disconnect': 'Disconnected Stripe', 'stripe.checkout': 'Started an online payment', 'stripe.payment': 'Recorded an online payment',
  'stripe.payouts': 'Changed where Stripe payouts go', 'stripe.payout': 'Booked a Stripe payout',
  'journal.draft': 'Drafted a journal entry', 'journal.edit': 'Changed a journal draft', 'journal.discard': 'Discarded a journal draft', 'journal.post': 'Posted a journal entry', 'journal.reverse': 'Reversed a journal entry',
  'match.approve': 'Approved a match', 'match.automatic': 'Matched a deposit automatically', 'match.undo': 'Undid a match',
  'member.invite': 'Invited a person', 'member.save': "Changed a person's role", 'owner.save': 'Changed the owner\'s name or email',
  'move-in.import': 'Imported the move-in', 'move-in.accept': 'Signed off the move-in', 'move-in.undo': 'Undid the move-in import', 'move-in.xero-connect': 'Connected Xero for attachments', 'move-in.xero-attachment': 'Carried an attachment over from Xero', 'move-in.xero-disconnect': 'Disconnected Xero',
  'payment.record': 'Recorded a payment', 'payment.allocate': 'Applied a payment', 'payment.method': "Changed how a payment was made",
  'period.lock': 'Locked the month', 'period.reopen-requested': 'Asked to reopen the month', 'period.reopen': 'Reopened the month', 'period.reopen-declined': 'Declined reopening the month',
  'proposal.file': 'Filed a proposal', 'proposal.approve': "Approved an agent's proposal", 'proposal.reject': "Rejected an agent's proposal", 'proposal.stale': 'A proposal went out of date',
  'question.read': 'Pantry read your answer', 'question.answer': 'Answered a question', 'question.dismiss': 'Set a question aside',
  'reader.save': 'Set up receipt reading', 'reader.remove': 'Turned off receipt reading',
  'receipt.receive': 'Received a receipt', 'receipt.read': 'Read a receipt', 'receipt.attach': 'Attached a receipt', 'receipt.attach-by-rule': 'Receipt attached by rule', 'receipt.dismiss': 'Set a receipt aside', 'receipt.not-needed': 'Marked a receipt not needed',
  'receipt-address.create': 'Set up the receipt email address', 'receipt-address.remove': 'Removed the receipt email address',
  'receipt-rule.save': 'Saved a receipt rule', 'receipt-rule.remove': 'Removed a receipt rule',
  'reconciliation.complete': 'Finished a reconciliation',
  'statement.import': 'Imported a statement', 'statement.correct-balances': "Corrected a statement's balances",
  'tax-code.create': 'Added a sales tax rate', 'tax-code.update': 'Changed a sales tax rate',
}

const RECORDS: Record<string, string> = {
  account: 'Account', agent: 'Agent', 'bank-account': 'Bank account', bill: 'Bill', chart: 'Chart of accounts', credit: 'Credit note',
  customer: 'Customer', vendor: 'Vendor', cutover: 'Move-in', document: 'Document', entity: 'Business', import: 'Move-in',
  invoice: 'Invoice', journal: 'Journal entry', match: 'Match', member: 'Person', payment: 'Payment', period: 'Month',
  proposal: 'Proposal', statement: 'Statement', 'tax-code': 'Sales tax rate', recurring: 'Recurring invoice', sending: 'Invoice sending', stripe: 'Stripe',
  'bank-rule': 'Bank rule', 'books-agent': 'Pantry', feed: 'Bank feed', gusto: 'Gusto', 'gusto-payroll': 'Gusto payroll', owner: 'You, the owner', question: 'Question',
  receipt: 'Receipt', 'receipt-rule': 'Receipt rule', settings: 'Settings', 'stripe-payout': 'Stripe payout', 'tax-year': '1099 year', xero: 'Xero',
}

const APPROVALS: Record<string, string> = {
  'period.lock': 'Locking the month', 'period.reopen': 'Reopening the month', 'bill.approve': 'Bill', 'invoice.approve': 'Invoice', 'credit.approve': 'Credit note', 'recurring.approve': 'Recurring invoice',
  'journal.post': 'Posting a journal entry', 'journal.reverse': 'Reversing a journal entry', 'cutover.accept': 'Move-in sign-off',
  'proposal.match': "Agent's bank match", 'proposal.journal': "Agent's journal entry", 'proposal.close-packet': "Agent's close packet", 'proposal.variance-note': "Agent's variance explanation",
  'recurring-journal.approve': 'Recurring journal entry', 'recognition.approve': 'Recognition schedule', 'recurring-price.approve': 'Recurring invoice price',
  'customer-refund.approve': 'Customer refund', 'autopay.scheduled-charge': 'Scheduled customer charge', 'tax-reminder-batch.send': 'Sending tax reminders',
  'credit.write-off': 'Writing off an invoice', 'journal.reclassify': 'Reclassifying a journal entry',
}

/** A code no one has worded yet, made readable: "gusto-payroll" → "Gusto payroll". */
const words = (code: string) => { const t = code.replace(/[-_.]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : code }

export const actionLabel = (action: string) => ACTIONS[action] ?? words(action)
export function approvalLabel(kind: string, action: string) {
  const verb = action.startsWith(`${kind}.`) ? action.slice(kind.length + 1) : action
  if (verb === 'approve-document-draft') return `${recordLabel(kind)} from a document`
  if (verb === 'integration.post') return `Posting ${recordLabel(kind).toLowerCase()} through a connection`
  return APPROVALS[`${kind}.${verb}`] ?? `${recordLabel(kind)} · ${words(verb)}`
}

/** The record an entry touched, in words; a month is named. */
export function recordLabel(kind: string, id?: string) {
  const label = RECORDS[kind] ?? words(kind)
  return kind === 'period' && id && /^\d{4}-\d{2}$/.test(id) ? `${label} · ${monthName(id)}` : label
}

/** The facts worth a person's reading from an entry's detail. */
export function detailFacts(detail: string | null | undefined): Record<string, string> {
  const d = detail ? JSON.parse(detail) : {}
  const facts: Record<string, string> = {}
  for (const [key, label] of [['label', 'Approval'], ['limitId', 'Limit'], ['limitRevision', 'Limit revision'], ['name', 'Name'], ['file', 'File'], ['memo', 'Memo'], ['task', 'Task'], ['reason', 'Reason'], ['summary', 'Summary'], ['reference', 'Reference'], ['vendor', 'Vendor']] as const)
    if (typeof d[key] === 'string' && d[key].trim()) facts[label] = d[key]
  if (typeof d.limit === 'number') facts['Limit amount (USD)'] = (d.limit / 100).toFixed(2)
  if (Array.isArray(d.added) && d.added.length) facts.Tasks = d.added.join(', ')
  return facts
}
