// Settings as sections (PW8, pick B): six groups by the owner's jobs, the owner's own and
// people first, each section a page at /app/settings/<slug>. A section is offered to whoever
// sees one of its cards, so the index, the rail and the section select always agree.
import type { D } from './kit'

export type Section = { slug: string; group: string; title: string; lead: string; heading?: (state: D) => string }

export const SETTINGS_GROUPS = ['You and your people', 'Your business', 'Getting paid', 'Payroll and receipts', 'Agents and API', 'Data and privacy']

export const SECTIONS: Section[] = [
  { slug: 'you', group: 'You and your people', title: 'You, the owner', lead: 'Your name and sign-in email.' },
  { slug: 'people', group: 'You and your people', title: 'People and permissions', lead: 'Who works in these books, what each role may see, and who may approve their own invoices.' },
  { slug: 'business', group: 'Your business', title: 'Business details', lead: 'Choose your shared Business first, then confirm the accounting details for these books.', heading: state => state.settings.entity ? 'Business details' : 'Set up the business' },
  { slug: 'dimensions', group: 'Your business', title: 'Classes, locations and projects', lead: 'Tracking and required coding.' },
  { slug: 'invoices', group: 'Getting paid', title: 'Invoices and reminders', lead: 'Email reminders, payment receipts, late fees and texts.' },
  { slug: 'stripe', group: 'Getting paid', title: 'Online payments (Stripe)', lead: 'Card and ACH payments, payouts and clearing.' },
  { slug: 'payroll', group: 'Payroll and receipts', title: 'Payroll (Gusto)', lead: 'Payrolls posted from Gusto.' },
  { slug: 'receipts', group: 'Payroll and receipts', title: 'Receipts', lead: 'AI reading and the receipts email address.' },
  { slug: 'agents', group: 'Agents and API', title: 'Agent access', lead: 'Agent tokens and monthly close preparation.' },
  { slug: 'api', group: 'Agents and API', title: 'API and webhooks', lead: 'Integration credentials, API calls and webhooks.' },
  { slug: 'connections', group: 'Data and privacy', title: 'Data & connections', lead: 'What each service receives, its path and fees.' },
  { slug: 'privacy', group: 'Data and privacy', title: 'Personal data and retention', lead: 'Erase a person’s data, and how long records are kept.' },
  { slug: 'hosting', group: 'Data and privacy', title: 'Put Pantry online', lead: 'Deploy to your own Cloudflare account.' },
]

/** The sections every Settings role reads (the rest are the owner's alone, as their cards are). */
export const SHARED_SECTIONS = ['business', 'invoices', 'stripe', 'payroll']

export const sectionPath = (slug: string) => `/app/settings/${slug}`

/** Put Pantry online exists only on the owner's own computer. */
export const onThisComputer = () => typeof window !== 'undefined' && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)

/** Whether this viewer has anything on the section's page: the owner everything (texting needs
 * no business, payments and payroll do), everyone else the shared cards once the business exists. */
export function sectionOpen(slug: string, state: D, local = onThisComputer()) {
  const business = !!state.settings.entity
  if (state.actor.can.owner) return slug === 'hosting' ? local : slug === 'stripe' || slug === 'payroll' ? business : true
  return slug === 'business' || (SHARED_SECTIONS.includes(slug) && business)
}

export const offeredSections = (state: D, local = onThisComputer()) => SECTIONS.filter(s => sectionOpen(s.slug, state, local))

/** The offered sections under their group labels, in index order. */
export const groupedSections = (sections: Section[]) => SETTINGS_GROUPS.map(group => ({ group, sections: sections.filter(s => s.group === group) })).filter(g => g.sections.length)
