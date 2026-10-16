import { createFileRoute } from '@tanstack/react-router'
import { Bank } from '../ui/bank'

export const Route = createFileRoute('/app/bank')({
  component: Bank,
  validateSearch: (search: Record<string, unknown>): { tab?: string; statement?: string } => ({
    ...(typeof search.tab === 'string' ? { tab: search.tab } : {}), ...(typeof search.statement === 'string' ? { statement: search.statement } : {}),
  }),
})
