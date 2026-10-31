// Settings used to be one page with #anchors. A hash never reaches the server, so an old link
// or bookmark to /app/settings#… is sent on to its section here, keeping its query
// (the Gusto return's gusto_error) and replacing the old address in history.
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { sectionPath } from './settings-sections'

const ANCHORS: Record<string, string> = { 'ai-reading': 'receipts', 'receipt-address': 'receipts', payroll: 'payroll', 'put-online': 'hosting', 'data-flows': 'connections' }

export function OldAnchor({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [target] = useState(() => typeof window === 'undefined' ? undefined : ANCHORS[window.location.hash.slice(1)])
  useEffect(() => { if (target) void navigate({ href: sectionPath(target) + window.location.search, replace: true }) }, [target, navigate])
  return target ? null : children
}
