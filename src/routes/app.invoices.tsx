import { createFileRoute, redirect } from '@tanstack/react-router'
import { LIST_ALIASES } from '../ui/record-paths'

// A guessed list address opens the real list. An id after it stays "Page not found".
export const Route = createFileRoute('/app/invoices')({ beforeLoad: () => { throw redirect({ ...LIST_ALIASES['/app/invoices'], replace: true }) } })
