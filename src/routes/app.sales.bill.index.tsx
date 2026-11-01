import { createFileRoute, redirect } from '@tanstack/react-router'
import { BARE_PARENTS } from '../ui/record-paths'

// The bare parent of a bill's address opens the list.
export const Route = createFileRoute('/app/sales/bill/')({ beforeLoad: () => { throw redirect({ ...BARE_PARENTS['/app/sales/bill'], replace: true }) } })
