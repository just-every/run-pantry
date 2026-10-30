import { createFileRoute } from '@tanstack/react-router'
import { Books } from '../ui/books'

export const Route = createFileRoute('/app/books')({ validateSearch: (search: Record<string, unknown>): { tab?: string } => Object.fromEntries(["tab"].filter(key => typeof search[key] === 'string').map(key => [key, search[key]])), component: Books })
