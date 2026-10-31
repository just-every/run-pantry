import { createFileRoute } from '@tanstack/react-router'
import { SettingsSection } from '../ui/settings-pages'

export const Route = createFileRoute('/app/settings/people')({ component: () => <SettingsSection slug="people" /> })
