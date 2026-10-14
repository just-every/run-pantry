import { createFileRoute } from '@tanstack/react-router'
import { Overview } from '../ui/overview'

export const Route = createFileRoute('/app/')({ component: Overview })
