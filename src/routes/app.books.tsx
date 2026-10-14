import { createFileRoute } from '@tanstack/react-router'
import { Books } from '../ui/books'

export const Route = createFileRoute('/app/books')({ component: Books })
