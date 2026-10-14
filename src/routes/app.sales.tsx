import { createFileRoute } from '@tanstack/react-router'
import { Sales } from '../ui/sales'

export const Route = createFileRoute('/app/sales')({ component: Sales })
