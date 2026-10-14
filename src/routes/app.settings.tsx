import { createFileRoute } from '@tanstack/react-router'
import { Settings } from '../ui/settings'

export const Route = createFileRoute('/app/settings')({ component: Settings })
