import { createFileRoute, redirect } from '@tanstack/react-router'
import { BARE_PARENTS } from '../ui/record-paths'

// The bare parent of a recurring invoice's address opens the list.
export const Route = createFileRoute('/app/sales/recurring/')({ beforeLoad: () => { throw redirect({ ...BARE_PARENTS['/app/sales/recurring'], replace: true }) } })
