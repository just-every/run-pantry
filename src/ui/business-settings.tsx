import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Card, command, Field, Form, PageHead, day, useShared } from './kit'
import { Icon } from './icons'

const ENTITY_LABEL: Record<string, string> = { 'sole-proprietorship': 'Sole proprietorship', 'single-member-llc': 'Single-member LLC', 'multi-member-llc': 'Multi-member LLC', 's-corporation': 'S corporation', 'c-corporation': 'C corporation', partnership: 'Partnership' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function Business() {
  const { state, reload } = useShared(), e = state.settings.entity, owner = state.actor.can.owner, choices = state.settings.choices
  // The date picker follows the browser's locale; the hint repeats the day in Pantry's own US format.
  const [start, setStart] = useState<string | undefined>(e?.books_start)
  return <Card title={<><Icon name="building" /> Accounting details</>}>
    {!owner && !e && <p>The owner sets up the business.</p>}
    {owner ? <Form label={e ? 'Save business' : 'Set up the business'} submit={b => command('entity.save', { ...b, revision: e?.revision })} onDone={reload} className="grid-form">
      <Field label="Legal name" name="legalName" defaultValue={e?.legal_name ?? state.settings.business?.legalName ?? state.settings.business?.name} required />
      <Field label="Entity type" name="entityType" defaultValue={e?.entity_type} required options={choices.entityTypes.map((t: string) => ({ value: t, label: ENTITY_LABEL[t] }))} />
      <Field label="State of organization" name="state" defaultValue={e?.state} required options={choices.states.map((s: string) => ({ value: s, label: s }))} />
      <Field label="Fiscal year starts" name="fiscalYearStart" defaultValue={e?.fiscal_year_start ?? 1} required options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
      <Field label="Books start" name="booksStart" type="date" defaultValue={e?.books_start} required onChange={(ev: any) => setStart(ev.target.value)} hint={start ? <>{day(start)} · the first day Pantry keeps the ledger</> : 'The first day Pantry keeps the ledger'} />
      <Field label="Tax accounting method (declared with your accountant)" name="taxMethod" defaultValue={e?.tax_method ?? 'undeclared'} required options={[{ value: 'undeclared', label: 'Not yet declared' }, { value: 'cash', label: 'Cash' }, { value: 'accrual', label: 'Accrual' }]} hint="Pantry keeps accrual books in US dollars. This records your declared tax method; it does not change it." />
      <Field label="Book and report policies" name="policies" type="textarea" defaultValue={e?.policies} wide hint="For example: capitalization threshold, revenue recognized when invoiced, accountant contact" />
    </Form> : e && <dl className="facts"><div><dt>Legal name</dt><dd>{e.legal_name}</dd></div><div><dt>Entity</dt><dd>{ENTITY_LABEL[e.entity_type]}, {e.state}</dd></div><div><dt>Fiscal year</dt><dd>Starts in {MONTHS[e.fiscal_year_start - 1]}</dd></div><div><dt>Books</dt><dd>Accrual, USD, from {day(e.books_start)}; declared tax method {e.tax_method}</dd></div></dl>}
  </Card>
}

export function BusinessSetup() {
  const { state } = useShared()
  const business = state.settings.business
  return <>
    <PageHead title={state.settings.entity ? 'Business details' : 'Set up the business'} lead="Choose your shared Business first, then confirm the accounting details for these books." />
    <Card title="Your shared Business">
      {business ? <p><strong>{business.name}</strong> · {new URL(business.origin).host}</p> : <p>Already use a Business in another Run Edit Run app? Open that same Business here.</p>}
      <a className="btn btn-secondary" href={business?.url ?? 'https://app.runeditrun.com/business'} target="_blank" rel="noreferrer">{business ? 'Open your Business' : 'Use your existing Business'}</a>
      <p>Business opens in a new tab and may ask you to sign in.</p>
    </Card>
    <Business />
    <p><Link className="btn btn-secondary" to="/app">Continue to setup steps</Link></p>
    <p><Link to="/app/settings">People &amp; settings</Link></p>
  </>
}

export function BusinessSummary() {
  const { state } = useShared()
  return <Card title={<><Icon name="building" /> The business</>}>
    <p>{state.settings.entity?.legal_name ?? state.settings.business?.name ?? 'Choose your shared Business and set up the accounting details for these books.'}</p>
    <Link className="btn btn-secondary" to="/app/settings" search={{ step: 'business' }}>{state.settings.entity ? 'Business details' : 'Set up the business'}</Link>
  </Card>
}
