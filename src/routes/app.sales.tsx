import { createFileRoute, redirect } from '@tanstack/react-router'
import { Sales } from '../ui/sales'

// The Sales layout: the list stays mounted while a record route (a customer, a vendor) opens beside it.
// The old ?tab=contacts&customer=<id> way in opens the customer's own address.
export const Route = createFileRoute('/app/sales')({
  validateSearch: (search: Record<string, unknown>): { tab?: string; invoice?: string; estimate?: string; bill?: string; customer?: string } => Object.fromEntries(["tab", "invoice", "estimate", "bill", "customer"].filter(key => typeof search[key] === 'string').map(key => [key, search[key]])),
  beforeLoad: ({ search }) => { if (search.tab === 'contacts' && search.customer) throw redirect({ to: '/app/sales/customer/$customerId', params: { customerId: search.customer }, replace: true }) },
  component: Sales,
})
