import type { Hono } from 'hono'
import { requireThat } from '../../core'
import { yearEndState } from '../../year-end'
import { estimateResources } from './estimates'
import { bankingResources } from './banking'
import { catalogResources, contactHistoryResource } from './catalog'
import { definitionResources, metadataResources } from './definitions'
import { providerResources } from './providers'
import { scheduleResources } from './schedules'
import { timeResources } from './time'
import { workflowResources } from './workflow'
import { authorizeRead, pick, registerResources, type ResourceEnv } from './model'

export const recordResources = [...estimateResources, ...catalogResources, contactHistoryResource, ...bankingResources, ...scheduleResources, ...timeResources, ...workflowResources, ...definitionResources, ...metadataResources, ...providerResources]

// Every distinct native parent record type is a separate owner selection. Child
// occurrences and nested references inherit only their named parent record consent.
export const READ_SCOPES = [
  ...['contacts', 'invoices', 'bills', 'journals', 'documents'].map(family => ({ id: family + ':read', label: family[0].toUpperCase() + family.slice(1) + ' readback', help: family==='contacts'?'Read contact details, aliases, delivery outcomes and linked business history metadata. Full linked records need their own scope.':'Read projected ' + family + ' records without write or posting permission.' })),
  { id: 'year-end:read', label: 'Year-end readiness', help: 'Read native fiscal-year close readiness; no financial statement or filing detail snapshots.' },
  ...[...new Map([...recordResources].reverse().filter(spec => !['contacts:read', 'journals:read'].includes(spec.scope)).map(spec => [spec.scope, {
    id: spec.scope, label: spec.scope.replace(':read', '').replaceAll('-', ' ') + ' readback', help: spec.description,
  }])).values()],
]

export function registerRecordReads(app: Hono<ResourceEnv>) {
  registerResources(app, recordResources)
  app.get('/year-end/:year', async c => {
    await authorizeRead(c, ['year-end:read'])
    const raw = c.req.param('year')
    requireThat(/^\d{4}$/.test(raw), 'Choose a fiscal year')
    const state = await yearEndState(c.env.DB, Number(raw))
    return c.json({ ...pick(state, 'year,start,end,periods,finalPeriod,taxYear,locked,ready,revision'),
      months: state.months.map((m: Record<string, unknown>) => pick(m, 'id,status,ready,tasksOpen,hasTasks')),
      checks: state.checks.map((check: Record<string, unknown>) => pick(check, 'key,title,ok')) })
  })
}
