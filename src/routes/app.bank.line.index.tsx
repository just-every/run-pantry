import { createFileRoute, redirect } from '@tanstack/react-router'
import { BARE_PARENTS } from '../ui/record-paths'

// The bare parent of a bank line's address opens the list.
export const Route = createFileRoute('/app/bank/line/')({ beforeLoad: () => { throw redirect({ ...BARE_PARENTS['/app/bank/line'], replace: true }) } })
