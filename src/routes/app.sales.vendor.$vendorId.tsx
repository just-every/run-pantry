import { createFileRoute } from '@tanstack/react-router'
import { HydrationUnit } from '../base/hydration/unit'
import { ContactRecord } from '../ui/contacts'

export const Route = createFileRoute('/app/sales/vendor/$vendorId')({ component: () => <HydrationUnit><ContactRecord key={Route.useParams().vendorId} kind="vendor" id={Route.useParams().vendorId} /></HydrationUnit> })
