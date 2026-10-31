import { createFileRoute, redirect } from '@tanstack/react-router'
import { SettingsIndex } from '../ui/settings-index'
import { OldAnchor } from '../ui/settings-anchors'

// Old ways in: ?step=business answers with Business details; the old #anchors (browser only) open their sections.
export const Route = createFileRoute('/app/settings/')({
  validateSearch: (search: Record<string, unknown>): { step?: 'business' } => ({ step: search.step === 'business' ? 'business' : undefined }),
  beforeLoad: ({ search }) => { if (search.step === 'business') throw redirect({ to: '/app/settings/business', replace: true }) },
  component: () => <OldAnchor><SettingsIndex /></OldAnchor>,
})
