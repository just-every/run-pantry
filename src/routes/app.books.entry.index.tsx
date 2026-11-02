import { createFileRoute, redirect } from '@tanstack/react-router'
import { BARE_PARENTS } from '../ui/record-paths'

// The bare parent of a journal entry's address opens the list.
export const Route = createFileRoute('/app/books/entry/')({ beforeLoad: () => { throw redirect({ ...BARE_PARENTS['/app/books/entry'], replace: true }) } })
