// Where the shell leads: the owner's daily jobs, the seldom-used tools on one page,
// search and Settings. Each passes roleScreen exactly as the HTTP doors do.
import { roleScreen } from './role-navigation'

export type Job = { to: string; label: string; tab: string; short: string; icon: string; count?: 'questions' | 'unmatchedLines' | 'receipts' }

/** Overview and the daily jobs: the bar's tabs, the phone's bottom bar and the Menu. */
export const JOBS: Job[] = [
  { to: '/app', label: 'Overview', tab: 'Overview', short: 'Overview', icon: 'home' },
  { to: '/app/questions', label: 'Questions from Pantry', tab: 'Questions', short: 'Questions', icon: 'question', count: 'questions' },
  { to: '/app/sales', label: 'Sales & bills', tab: 'Sales & bills', short: 'Sales', icon: 'invoice' },
  { to: '/app/bank', label: 'Bank', tab: 'Bank', short: 'Bank', icon: 'bank', count: 'unmatchedLines' },
  { to: '/app/receipts', label: 'Receipts', tab: 'Receipts', short: 'Receipts', icon: 'receipt', count: 'receipts' },
  { to: '/app/books', label: 'Books', tab: 'Books', short: 'Books', icon: 'book' },
  { to: '/app/close', label: 'Close', tab: 'Close', short: 'Close', icon: 'check' },
  { to: '/app/reports', label: 'Reports', tab: 'Reports', short: 'Reports', icon: 'chart' },
  { to: '/app/time', label: 'Time', tab: 'Time', short: 'Time', icon: 'clock' },
]

/** The tools page, /app/tools. */
export const TOOLS = [
  { to: '/app/agents', label: 'Agent work' },
  { to: '/app/cash-planner', label: 'Cash planner' },
  { to: '/app/collections', label: 'Collection drafts' },
  { to: '/app/documents', label: 'Documents' },
  { to: '/app/assets', label: 'Fixed assets' },
  { to: '/app/currency', label: 'Foreign amount worksheets' },
  { to: '/app/move-in', label: 'Move in from QuickBooks or Xero' },
] as const

export const SEARCH = '/app/search', TOOLS_PAGE = '/app/tools', SETTINGS = '/app/settings'
const under = (path: string, to: string) => path === to || path.startsWith(to + '/')

/** The one entry the address belongs to (DL6): Overview only on /app, Tools for the tools,
 * Settings for Settings and Activity, otherwise the longest matching path; none outside them all. */
export function currentEntry(path: string): string | null {
  if (path === '/app') return '/app'
  if (path === TOOLS_PAGE || TOOLS.some(t => under(path, t.to))) return TOOLS_PAGE
  if (under(path, SETTINGS) || under(path, '/app/activity')) return SETTINGS
  return [...JOBS.slice(1).map(j => j.to), SEARCH].filter(to => under(path, to)).sort((a, b) => b.length - a.length)[0] ?? null
}

/** What this person's shell offers. Before the state answers, nothing role-bound is offered. */
export function offered(actor: { role: string; policy?: { bankAccounts?: unknown } | null } | undefined) {
  const allowed = (to: string) => !!actor && roleScreen(actor.role, to, actor.policy?.bankAccounts != null)
  const tools = TOOLS.filter(t => allowed(t.to))
  return { jobs: JOBS.filter(j => allowed(j.to)), tools, search: allowed(SEARCH), toolsPage: tools.length > 0 && allowed(TOOLS_PAGE), settings: allowed(SETTINGS) }
}

/** A waiting count as the bar shows it; none at zero. */
export const countText = (n?: number) => !n ? null : n > 99 ? '99+' : String(n)
