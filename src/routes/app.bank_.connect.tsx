import { createFileRoute } from '@tanstack/react-router'
import { Connect } from '../ui/bank-connect'

export const Route = createFileRoute('/app/bank_/connect')({
  component: Connect,
  validateSearch: (search: Record<string, unknown>): { connection?: string } => typeof search.connection === 'string' ? { connection: search.connection } : {},
})
