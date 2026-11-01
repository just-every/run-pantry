import { createFileRoute, redirect } from '@tanstack/react-router'
import { LIST_ALIASES } from '../ui/record-paths'

// A guessed list address opens the real list.
export const Route = createFileRoute('/app/bills')({ beforeLoad: () => { throw redirect({ ...LIST_ALIASES['/app/bills'], replace: true }) } })
