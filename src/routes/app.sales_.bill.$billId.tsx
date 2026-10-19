import { createFileRoute } from '@tanstack/react-router'
import { Sales } from '../ui/sales'

// The record identifier is in the path so signing in from an approval email
// returns to this bill, even when the sign-in link opens in a new browser tab.
export const Route = createFileRoute('/app/sales_/bill/$billId')({ component: BillApproval })
function BillApproval() {
  return <Sales billId={Route.useParams().billId} />
}
