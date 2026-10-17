// Activity in words: what each recorded action and approval means to a person.
import { monthName } from './kit'

const ACTIONS: Record<string, string> = {
  'account.create': 'Added an account', 'account.update': 'Changed an account',
  'agent.create': 'Created an agent token', 'agent.deactivate': 'Turned off an agent token',
  'bank-account.create': 'Added a bank account',
  'bill.draft': 'Drafted a bill', 'bill.edit': 'Changed a bill draft', 'bill.record': 'Recorded a bill', 'bill.evidence-waived': "Waived a bill's receipt",
  'chart.start': 'Started the chart of accounts',
  'close.tasks': 'Added review tasks', 'close.task-done': 'Finished a review task', 'close.task-reopened': 'Reopened a review task',
  'contact.create': 'Added a customer or vendor', 'contact.update': 'Changed a customer or vendor',
  'credit.draft': 'Drafted a credit note', 'credit.edit': 'Changed a credit note draft', 'credit.approve': 'Approved a credit note', 'credit.issue': 'Issued a credit note',
  'document.upload': 'Uploaded a document',
  'entity.create': 'Set up the business', 'entity.update': 'Changed the business details',
  'invoice.draft': 'Drafted an invoice', 'invoice.edit': 'Changed an invoice draft', 'invoice.approve': 'Approved an invoice', 'invoice.issue': 'Issued an invoice',
  'invoice.send': 'Sent an invoice', 'invoice.remind': 'Sent a payment reminder', 'invoice.viewed': 'Opened the invoice link', 'invoice.reminders-paused': "Paused an invoice's reminders", 'invoice.reminders-resumed': "Resumed an invoice's reminders",
  'recurring.create': 'Set up a recurring invoice', 'recurring.edit': 'Changed a recurring invoice', 'recurring.approve': 'Approved a recurring invoice', 'recurring.run': 'Created a recurring invoice', 'recurring.failed': 'A recurring invoice could not be created',
  'recurring.pause': 'Paused a recurring invoice', 'recurring.resume': 'Resumed a recurring invoice', 'recurring.end': 'Ended a recurring invoice',
  'sending.update': 'Changed invoice sending and reminders',
  'stripe.connect': 'Connected Stripe', 'stripe.methods': 'Changed online payment methods', 'stripe.disconnect': 'Disconnected Stripe', 'stripe.checkout': 'Started an online payment', 'stripe.payment': 'Recorded an online payment',
  'journal.draft': 'Drafted a journal entry', 'journal.edit': 'Changed a journal draft', 'journal.discard': 'Discarded a journal draft', 'journal.post': 'Posted a journal entry', 'journal.reverse': 'Reversed a journal entry',
  'match.approve': 'Approved a match', 'match.automatic': 'Matched a deposit automatically', 'match.undo': 'Undid a match',
  'member.invite': 'Invited a person', 'member.save': "Changed a person's role",
  'move-in.import': 'Imported the move-in', 'move-in.accept': 'Signed off the move-in', 'move-in.undo': 'Undid the move-in import', 'move-in.xero-connect': 'Connected Xero for attachments', 'move-in.xero-attachment': 'Carried an attachment over from Xero', 'move-in.xero-disconnect': 'Disconnected Xero',
  'payment.record': 'Recorded a payment', 'payment.allocate': 'Applied a payment',
  'period.lock': 'Locked the month', 'period.reopen-requested': 'Asked to reopen the month', 'period.reopen': 'Reopened the month', 'period.reopen-declined': 'Declined reopening the month',
  'proposal.file': 'Filed a proposal', 'proposal.approve': "Approved an agent's proposal", 'proposal.reject': "Rejected an agent's proposal", 'proposal.stale': 'A proposal went out of date',
  'reconciliation.complete': 'Finished a reconciliation',
  'statement.import': 'Imported a statement', 'statement.correct-balances': "Corrected a statement's balances",
  'tax-code.create': 'Added a sales tax rate',
}

const RECORDS: Record<string, string> = {
  account: 'Account', agent: 'Agent', 'bank-account': 'Bank account', bill: 'Bill', chart: 'Chart of accounts', credit: 'Credit note',
  customer: 'Customer', vendor: 'Vendor', cutover: 'Move-in', document: 'Document', entity: 'Business', import: 'Move-in',
  invoice: 'Invoice', journal: 'Journal entry', match: 'Match', member: 'Person', payment: 'Payment', period: 'Month',
  proposal: 'Proposal', statement: 'Statement', 'tax-code': 'Sales tax rate', recurring: 'Recurring invoice', sending: 'Invoice sending', stripe: 'Stripe',
}

const APPROVALS: Record<string, string> = {
  'period.lock': 'Locking the month', 'period.reopen': 'Reopening the month', 'invoice.approve': 'Invoice', 'credit.approve': 'Credit note', 'recurring.approve': 'Recurring invoice',
  'journal.post': 'Posting a journal entry', 'journal.reverse': 'Reversing a journal entry', 'cutover.accept': 'Move-in sign-off',
  'proposal.match': "Agent's bank match", 'proposal.journal': "Agent's journal entry", 'proposal.close-packet': "Agent's close packet", 'proposal.variance-note': "Agent's variance explanation",
}

export const actionLabel = (action: string) => ACTIONS[action] ?? action
export const approvalLabel = (kind: string, action: string) => APPROVALS[`${kind}.${action}`] ?? `${recordLabel(kind)} · ${action}`

/** The record an entry touched, in words; a month is named. */
export function recordLabel(kind: string, id?: string) {
  const label = RECORDS[kind] ?? kind
  return kind === 'period' && id && /^\d{4}-\d{2}$/.test(id) ? `${label} · ${monthName(id)}` : label
}

/** The facts worth a person's reading from an entry's detail. */
export function detailFacts(detail: string | null | undefined): Record<string, string> {
  const d = detail ? JSON.parse(detail) : {}
  const facts: Record<string, string> = {}
  for (const [key, label] of [['name', 'Name'], ['file', 'File'], ['memo', 'Memo'], ['task', 'Task'], ['reason', 'Reason'], ['summary', 'Summary'], ['reference', 'Reference'], ['vendor', 'Vendor']] as const)
    if (typeof d[key] === 'string' && d[key].trim()) facts[label] = d[key]
  if (Array.isArray(d.added) && d.added.length) facts.Tasks = d.added.join(', ')
  return facts
}
