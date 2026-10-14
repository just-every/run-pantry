import { createFileRoute } from '@tanstack/react-router'
import { Bank } from '../ui/bank'

export const Route = createFileRoute('/app/bank')({ component: Bank })
