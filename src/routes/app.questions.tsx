import { createFileRoute } from '@tanstack/react-router'
import { Questions } from '../ui/questions'

// The question an email links to lives in the address (?q=), so the link opens it.
export const Route = createFileRoute('/app/questions')({
  validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === 'string' && s.q ? { q: s.q } : {}),
  component: () => <Questions focus={Route.useSearch().q} />,
})
