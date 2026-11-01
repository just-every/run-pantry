import { createFileRoute, redirect } from '@tanstack/react-router'
import { BARE_PARENTS } from '../ui/record-paths'

// The bare parent of a vendor's address opens the list.
export const Route = createFileRoute('/app/sales/vendor/')({ beforeLoad: () => { throw redirect({ ...BARE_PARENTS['/app/sales/vendor'], replace: true }) } })
