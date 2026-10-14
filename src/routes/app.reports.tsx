import { createFileRoute } from '@tanstack/react-router'
import { Reports } from '../ui/reports'

export const Route = createFileRoute('/app/reports')({ component: Reports })
