import { useEffect, useState, type ChangeEvent } from 'react'
import { Field } from './kit'

/** Calendar dates retain their day; instants use the browser's calendar and omit seconds. */
export function dateText(iso?: string | null) {
  if (!iso) return '—'
  const value = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function timeText(iso?: string | null) {
  if (!iso) return '—'
  if (iso.length === 10) return dateText(iso)
  return dateText(iso) + ' at ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function readableTimes(text: string) {
  return text.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, timeText)
}

export function shortMonth(period: string) {
  return new Date(period + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function CustomerTimeZone() {
  const [zone, setZone] = useState(''), [zones, setZones] = useState<string[]>([])
  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone
    setZone(local)
    setZones([...new Set([local, 'UTC', ...Intl.supportedValuesOf('timeZone')])])
  }, [])
  return <Field label="Customer time zone" name="timeZone" value={zone} onChange={(e: ChangeEvent<HTMLSelectElement>) => setZone(e.target.value)} required options={zones.map(value => ({ value, label: value.replaceAll('_', ' ') }))} />
}
