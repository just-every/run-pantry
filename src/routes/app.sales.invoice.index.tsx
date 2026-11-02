import { createFileRoute, redirect } from '@tanstack/react-router'
import { BARE_PARENTS } from '../ui/record-paths'

// The bare parent of an invoice's address opens the list.
export const Route = createFileRoute('/app/sales/invoice/')({ beforeLoad: () => { throw redirect({ ...BARE_PARENTS['/app/sales/invoice'], replace: true }) } })
