import { createFileRoute } from '@tanstack/react-router'
import { Receipts } from '../ui/receipts'

export const Route = createFileRoute('/app/receipts')({ component: Receipts })
