import { createFileRoute } from '@tanstack/react-router'
import { SettingsSection } from '../ui/settings-pages'

export const Route = createFileRoute('/app/settings/payroll')({ component: () => <SettingsSection slug="payroll" /> })
