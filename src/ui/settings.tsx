import { TextingSettings } from './texting'
// People & settings: the business, its declared policies, who has which role, and agent access.
import { DimensionSettings } from './dimensions'
import { useState } from 'react'
import { Action, Card, Chip, command, Details, Field, Form, PageHead, ROLE_LABEL, Table, day, placeholderEmail, useShared, type D } from './kit'
import { Icon } from './icons'
import { BusinessSummary } from './business-settings'
import { IssuingLimits } from './issuing-limits'
import { ReceiptSettings } from './receipt-settings'
import { InvoicingSettings } from './invoicing-settings'
import { ConnectedSettings } from './connected-settings'
import { WebhookSettings } from './webhook-settings'
import { ErasureSettings } from './erasure-settings'
import { IntegrationSettings } from './integration-settings'
import { DataFlows } from './data-flows'
import { People, RolePrivacy } from './people'

/** The owner's own name and sign-in email, as people and invoices see them. */
function Owner() {
  const { state, reload } = useShared(), me = state.actor, [saved, setSaved] = useState(0)
  const here = onThisComputer(), setupOwner = state.settings.setupOwner
  return <Card title="You, the owner">
    <Form key={saved} label="Save name and email" submit={b => command('owner.save', b)} onDone={async () => { await reload(); setSaved(n => n + 1) }} className="grid-form">
      <Field label="Your name" name="name" defaultValue={me.name} required hint="Shown on entries you prepare or post, and to the people you invite" />
      <Field label="Your sign-in email" name="email" type="email" defaultValue={me.email} required hint={placeholderEmail(me.email) ? `${me.email} is a placeholder no mail reaches, which is fine on this computer. Put Pantry online (below) asks for your own email for the hosted Pantry.` : 'Where your sign-in links go. Entries you already made keep the address they were made with.'} />
    </Form>
    {here && setupOwner && setupOwner !== me.email && <details className="setup-steps"><summary>Set up: stay the owner when Pantry goes online</summary><p className="hint">Put <code>OWNER_EMAIL={me.email}</code> in <code>.env.pantry</code> (see <a href="#put-online">Put Pantry online</a>). Without it, the hosted Pantry's owner is {setupOwner}, the address this Pantry was first set up with.</p></details>}
  </Card>
}

function Agents() {
  const { state, reload } = useShared(), [token, setToken] = useState<D | null>(null)
  return <Card title={<><Icon name="agent" /> Agent access</>}>
    <p>An agent reads your books through its token and files proposals. A person approves each one; agents never post, approve or lock.</p>
    {token && <div className="callout callout-warn" role="status"><strong>Copy this token now — it is shown once.</strong><code className="token">{token.token}</code><span>Give it to {token.name}; it is that agent's key to these books.</span>
      <details className="setup-steps"><summary>Set up the agent with its token</summary><p className="hint">The agent reads the token from <code>PANTRY_AGENT_TOKEN</code>.</p></details></div>}
    <Table heads={['Agent', 'Created', 'Status', '']} empty="No agents yet.">
      {state.settings.agents.map((a: D) => <tr key={a.id}><td>{a.name}</td><td>{day(a.created_at)} by {a.created_by}</td><td>{a.active ? <Chip tone="good">Active</Chip> : <Chip>Turned off</Chip>}</td><td>{a.active ? <Action tone="danger" run={async () => { await command('agent.deactivate', { id: a.id }); await reload() }}>Turn off</Action> : null}<Details facts={{ id: a.id }} /></td></tr>)}
    </Table>
    <Form label="Create agent token" submit={b => command('agent.create', b)} onDone={async r => { setToken(r); await reload() }} className="grid-form"><Field label="Agent name" name="name" required /></Form>
  </Card>
}

const onThisComputer = () => typeof window !== 'undefined' && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)

/** On this computer only: what to put in the deploy file, with this owner's own email, and where the steps are.
 *  A placeholder owner address (no mail reaches it) is never offered: the card asks for the owner's own email
 *  and fills the lines with that. This browser remembers it; the sign-in here is unchanged. */
function Hosting() {
  const { state } = useShared(), me = state.actor
  const [typed, setTyped] = useState(() => { try { return window.localStorage.getItem(HOSTED_OWNER) ?? '' } catch { return '' } })
  if (!onThisComputer()) return null
  const placeholder = placeholderEmail(me.email), owner = placeholder ? typed.trim().toLowerCase() : me.email
  const ready = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner) && !placeholderEmail(owner)
  const remember = (value: string) => { setTyped(value); try { window.localStorage.setItem(HOSTED_OWNER, value) } catch {} }
  const lines = [`OWNER_EMAIL=${owner}`, 'CLOUDFLARE_ACCOUNT_ID=your account ID', 'CLOUDFLARE_API_TOKEN=the token', 'MAIL_PROVIDER=resend', 'MAIL_API_KEY=your mail provider\'s API key', 'MAIL_FROM=billing@example.com']
  return <section id="put-online"><Card title="Put Pantry online">
    <p>Put Pantry on your own Cloudflare account and your accountant can sign in from anywhere, with invoices going out by email.</p>
    <a className="btn btn-secondary" href="https://run-pantry.com/docs/hosting" target="_blank" rel="noreferrer">How to put Pantry online</a>
    <details className="setup-steps"><summary>Set up hosting</summary>
      <p className="hint">This Pantry runs on your own computer, so only you can reach it and it sends no email. You need a free Cloudflare account and a mail provider account (Resend or SendGrid); neither is set up for this Pantry yet.</p>
      {placeholder && <>
        <p className="hint">You sign in here as {me.email}, a placeholder no mail reaches. The hosted Pantry emails your sign-in links to its owner, so give your own email:</p>
        <div className="grid-form hosted-owner"><Field label="Your own email" name="hostedOwner" type="email" value={typed} onChange={(e: any) => remember(e.target.value)} hint="Where the hosted Pantry sends your sign-in links" error={typed && !ready ? 'Use a mailbox you can read: not a .test, .example or .localhost address' : undefined} /></div>
      </>}
      {ready ? <>
        <p className="hint">The deploy file, <code>.env.pantry</code> in your <code>run-pantry</code> folder, holds these lines; <code>OWNER_EMAIL</code> makes you, at {owner}, the hosted Pantry's owner, and your sign-in links go there:</p>
        <pre className="env-lines"><code>{lines.join('\n')}</code></pre>
        <p className="hint">Stop Pantry here first (<code>rer dev --stop</code>): <code>rer deploy</code> refuses while it runs. Then one command, <code>rer deploy --env-file .env.pantry</code>, puts it online.</p>
      </> : <p className="hint">The deploy lines appear here once you give your email.</p>}
    </details>
  </Card></section>
}

const HOSTED_OWNER = 'pantry.hosted-owner-email'

export function Settings() {
  const { state } = useShared()
  return <>
    <PageHead title="People & settings" lead="The business these books belong to, invoice sending and online payments, Stripe payouts and Gusto payroll, who works in them, agent access, and how receipts are read and received." />
    <BusinessSummary /><DimensionSettings />
    {state.settings.entity && <><InvoicingSettings /><ConnectedSettings /></>}
    {state.actor.can.owner && <><TextingSettings /><DataFlows /><Owner /><People /><RolePrivacy /><IssuingLimits /><Agents /><IntegrationSettings /><WebhookSettings /><ErasureSettings /><ReceiptSettings /><Hosting /></>}
  </>
}
