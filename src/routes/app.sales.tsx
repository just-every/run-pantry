import { createFileRoute } from '@tanstack/react-router'
import { Sales } from '../ui/sales'

export const Route = createFileRoute('/app/sales')({ validateSearch: (search: Record<string, unknown>): { tab?: string; invoice?: string; estimate?: string; bill?: string } => Object.fromEntries(["tab", "invoice", "estimate", "bill"].filter(key => typeof search[key] === 'string').map(key => [key, search[key]])), component: Sales })
