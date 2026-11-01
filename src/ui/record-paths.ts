// The one map from a record to its address, and from an old or guessed address to its list.
// Later record kinds add their rows here; a kind is listed only once its route exists.

/** A list the records belong to: where its back control goes and what it is called. */
export type RecordList = { label: string; to: '/app/sales' | '/app/books' | '/app/bank'; search?: Record<string, string> }

export const CONTACTS_LIST: RecordList = { label: 'Customers & vendors', to: '/app/sales', search: { tab: 'contacts' } }

type Kind = 'customer' | 'vendor'

/** The canonical address of a record: `/app/sales/customer/<id>` and `/app/sales/vendor/<id>`. */
export function recordPath(kind: Kind, id: string) {
  return `/app/sales/${kind}/${encodeURIComponent(id)}`
}

/** The list address of a bare parent such as /app/sales/customer. */
export const BARE_PARENTS = {
  '/app/sales/invoice': { to: '/app/sales' },
  '/app/sales/bill': { to: '/app/sales', search: { tab: 'bills' } },
  '/app/sales/recurring': { to: '/app/sales', search: { tab: 'recurring' } },
  '/app/sales/customer': { to: '/app/sales', search: { tab: 'contacts' } },
  '/app/sales/vendor': { to: '/app/sales', search: { tab: 'contacts' } },
  '/app/books/entry': { to: '/app/books', search: { tab: 'journal' } },
  '/app/bank/line': { to: '/app/bank' },
} as const

/** Guessed list addresses. They never take an id: /app/invoices/INV-0228 stays "Page not found". */
export const LIST_ALIASES = {
  '/app/invoices': { to: '/app/sales' },
  '/app/bills': { to: '/app/sales', search: { tab: 'bills' } },
  '/app/customers': { to: '/app/sales', search: { tab: 'contacts' } },
  '/app/accounts': { to: '/app/books' },
} as const

/** A report slug opens the report page at `?report=<slug>`. */
export const reportAddress = (slug: string) => ({ to: '/app/reports' as const, search: { report: slug } })
