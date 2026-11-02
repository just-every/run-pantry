import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { KINDS } from '../ui/reports'
import { reportAddress } from '../ui/record-paths'

// /app/reports/profit-and-loss opens that report; a slug the Reports page does not list is "Page not found".
export const Route = createFileRoute('/app/reports/$slug')({
  beforeLoad: ({ params }) => { throw KINDS.some(k => k[1] === params.slug) ? redirect({ ...reportAddress(params.slug), replace: true }) : notFound() },
})
