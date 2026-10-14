import { createFileRoute } from '@tanstack/react-router'
import { Activity } from '../ui/more'

export const Route = createFileRoute('/app/activity')({ component: Activity })
