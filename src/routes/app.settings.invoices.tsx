import { createFileRoute } from '@tanstack/react-router'
import { SettingsSection } from '../ui/settings-pages'

export const Route = createFileRoute('/app/settings/invoices')({ component: () => <SettingsSection slug="invoices" /> })
