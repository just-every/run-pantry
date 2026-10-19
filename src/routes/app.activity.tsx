import { createFileRoute } from '@tanstack/react-router'
import { Activity } from '../ui/activity'

export const Route = createFileRoute('/app/activity')({ component: Activity })
