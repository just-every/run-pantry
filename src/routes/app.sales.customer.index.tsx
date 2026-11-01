import { createFileRoute, redirect } from '@tanstack/react-router'
import { BARE_PARENTS } from '../ui/record-paths'

// The bare parent of a customer's address opens the list.
export const Route = createFileRoute('/app/sales/customer/')({ beforeLoad: () => { throw redirect({ ...BARE_PARENTS['/app/sales/customer'], replace: true }) } })
