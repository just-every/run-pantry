import { createFileRoute } from '@tanstack/react-router'
import { Settings } from '../ui/settings'
import { BusinessSetup } from '../ui/business-settings'

export const Route = createFileRoute('/app/settings')({
  validateSearch: (search: Record<string, unknown>): { step?: 'business' } => ({ step: search.step === 'business' ? 'business' : undefined }),
  component: SettingsPage,
})

function SettingsPage() {
  return Route.useSearch().step === 'business' ? <BusinessSetup /> : <Settings />
}
