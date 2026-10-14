import { createFileRoute } from '@tanstack/react-router'
import { Agents } from '../ui/more'

export const Route = createFileRoute('/app/agents')({ component: Agents })
