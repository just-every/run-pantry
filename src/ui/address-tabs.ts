import { useEffect } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'

/** Tabs share the app's query-addressed navigation, including reload and Back. */
export function useAddressTab(path: '/app/sales' | '/app/books' | '/app/bank', tabs: readonly (readonly [string, string])[], fallback?: string) {
  const location = useLocation(), navigate = useNavigate()
  const query = new URLSearchParams(location.searchStr), requested = query.get('tab')
  const current = tabs.find(([, key]) => key === requested?.replaceAll(' ', '-'))?.[0] ?? fallback ?? tabs[0][0]
  const change = (label: string, replace = false) => {
    const key = tabs.find(([name]) => name === label)?.[1]
    if (key === tabs[0][1]) query.delete('tab')
    else if (key) query.set('tab', key)
    query.delete('statement')
    void navigate({ to: path, search: Object.fromEntries(query), replace, resetScroll: false })
  }
  // Retain old shared Bank links while giving them the one canonical slug.
  useEffect(() => {
    if (requested?.includes(' ') && tabs.some(([, key]) => key === requested.replaceAll(' ', '-'))) change(current, true)
  }, [requested])
  return [current, change] as const
}
