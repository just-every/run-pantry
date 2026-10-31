// Each Settings section's page: its head, then its cards in order (DESIGN-BRIEF §2.2). Every
// card keeps its own form, buttons and refusals; nothing saves for a whole page.
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { PageHead, useShared } from './kit'
import { SECTIONS, sectionOpen, sectionPath } from './settings-sections'
import { Agents, Hosting, Owner } from './settings'
import { People, RolePrivacy } from './people'
import { IssuingLimits } from './issuing-limits'
import { BusinessDetails } from './business-settings'
import { DimensionSettings } from './dimensions'
import { InvoiceSettings, PaymentSettings } from './invoicing-settings'
import { PayrollSettings } from './connected-settings'
import { ReceiptSettings } from './receipt-settings'
import { IntegrationSettings } from './integration-settings'
import { WebhookSettings } from './webhook-settings'
import { DataFlows } from './data-flows'
import { ErasureSettings } from './erasure-settings'

const PAGES: Record<string, () => ReactNode> = {
  you: () => <Owner />,
  people: () => <><People /><RolePrivacy /><IssuingLimits /></>,
  business: () => <BusinessDetails />,
  dimensions: () => <DimensionSettings />,
  invoices: () => <InvoiceSettings />,
  stripe: () => <PaymentSettings />,
  payroll: () => <PayrollSettings />,
  receipts: () => <ReceiptSettings />,
  agents: () => <Agents />,
  api: () => <><IntegrationSettings /><WebhookSettings /></>,
  connections: () => <DataFlows />,
  privacy: () => <ErasureSettings />,
  hosting: () => <Hosting />,
}

/** Why a section this viewer may open holds nothing for them yet. */
function Closed({ slug }: { slug: string }) {
  const owner = useShared().state.actor.can.owner
  if (slug === 'hosting') return <p>Put Pantry online from the computer it runs on.</p>
  return owner ? <><p>Choose your shared Business and set up the accounting details for these books.</p><Link className="btn btn-primary" to={sectionPath('business')}>Set up the business</Link></> : <p>The owner sets up the business.</p>
}

export function SettingsSection({ slug }: { slug: string }) {
  const { state } = useShared(), section = SECTIONS.find(s => s.slug === slug)!
  return <>
    <PageHead title={section.heading?.(state) ?? section.title} lead={section.lead} />
    {sectionOpen(slug, state) ? PAGES[slug]() : <Closed slug={slug} />}
  </>
}
