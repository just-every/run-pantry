import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { ContactRecord } from '../ui/contacts'

export const Route = createFileRoute('/app/sales/customer/$customerId')({ component: () => <HydrationUnit><ContactRecord key={Route.useParams().customerId} kind="customer" id={Route.useParams().customerId} /></HydrationUnit> })
