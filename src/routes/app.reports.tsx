import { createFileRoute } from '@tanstack/react-router'
import { Reports, type ReportSearch } from '../ui/reports'

// Which report, basis, period, figure and record are open lives in the address, so every level links and goes back.
const KEYS = ['report', 'basis', 'from', 'to', 'line', 'record', 'year', 'columns', 'account', 'payee', 'customId', 'row', 'column', 'node', 'origin'] as const

export const Route = createFileRoute('/app/reports')({
  validateSearch: (s: Record<string, unknown>): ReportSearch => Object.fromEntries(KEYS.filter(k => s[k] !== undefined && s[k] !== '').map(k => [k, String(s[k])])),
  component: Reports,
})
