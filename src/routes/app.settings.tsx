import { createFileRoute } from '@tanstack/react-router'
import { SettingsLayout } from '../ui/settings-nav'

export const Route = createFileRoute('/app/settings')({ component: SettingsLayout })
