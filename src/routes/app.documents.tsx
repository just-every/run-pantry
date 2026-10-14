import { createFileRoute } from '@tanstack/react-router'
import { Documents } from '../ui/more'

export const Route = createFileRoute('/app/documents')({ component: Documents })
