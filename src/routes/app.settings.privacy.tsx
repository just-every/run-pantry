import { createFileRoute } from '@tanstack/react-router'
import { SettingsSection } from '../ui/settings-pages'

export const Route = createFileRoute('/app/settings/privacy')({ component: () => <SettingsSection slug="privacy" /> })
