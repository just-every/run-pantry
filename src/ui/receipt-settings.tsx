// The owner's two receipt settings, each completable on this page: the AI
// model key that reads receipts, and the Pantry address that receives them.
import { useState } from 'react'
import { Action, Card, Chip, command, day, Field, Form, Loading, useView, type D } from './kit'
import { Icon } from './icons'

function ReadingCard({ reader, onChange }: { reader: D; onChange: () => Promise<void> }) {
  const saved = reader.saved, [provider, setProvider] = useState<string>(saved?.provider ?? 'anthropic'), [check, setCheck] = useState<D | null>(null)
  const chip = reader.unavailable ? <Chip>Not available here</Chip> : reader.missing ? <Chip tone="warn">No key</Chip> : <Chip tone="good">Reading receipts</Chip>
  return <section id="ai-reading"><Card title={<><Icon name="agent" /> AI reading</>} actions={chip}>
    {reader.unavailable ? <p>{reader.unavailable}</p> : <>
      <p>{reader.missing ? `${reader.missing} ` : ''}Pantry reads the vendor, date, total, tax and currency of each receipt with your own AI provider account. It sends the receipt and your expense account names to that provider, and only ever proposes: a person accepts before anything is attached.</p>
      <details className="details setup-steps"><summary>Get a key</summary><ol>
        <li><strong>Anthropic:</strong> open <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com → API keys</a>, choose <strong>Create Key</strong>, and copy it. An organization key that is not tied to one workspace also needs that workspace’s ID (Console → Workspaces).</li>
        <li><strong>OpenAI or another OpenAI-compatible provider:</strong> open <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com → API keys</a>, create a key, and enter a model that reads images and PDFs.</li>
        <li>Paste it below and choose <strong>Save</strong>, then <strong>Test the key</strong>.</li>
      </ol></details>
      <Form key={saved?.revision ?? 'new'} label={saved ? 'Save' : 'Save key'} submit={b => command('reader.save', { ...b, provider })} onDone={async () => { setCheck(null); await onChange() }} className="grid-form">
        <Field label="Provider" name="providerChoice" value={provider} onChange={(e: any) => setProvider(e.target.value)} options={[{ value: 'anthropic', label: 'Anthropic (Claude)' }, { value: 'openai', label: 'OpenAI or OpenAI-compatible' }]} />
        <Field label="Model" name="model" defaultValue={saved?.provider === provider ? saved.model : reader.defaults[provider].model} placeholder={provider === 'openai' ? 'The model name from your provider' : ''} required={provider === 'openai'} />
        <Field label="API key" name="key" type="password" autoComplete="off" placeholder={saved ? `Saved key ${saved.key_hint}; paste a new one to replace it` : 'Paste the key'} required={!saved} />
        {provider === 'anthropic' ? <Field label="Workspace ID (only for keys not tied to a workspace)" name="workspace" defaultValue={saved?.workspace ?? ''} placeholder="wrkspc_…" />
          : <Field label="Endpoint" name="endpoint" defaultValue={saved?.provider === 'openai' ? saved.endpoint : reader.defaults.openai.endpoint} />}
      </Form>
      {saved && <div className="row-actions">
        <Action run={async () => setCheck(await command('reader.test', {}))}>Test the key</Action>
        <Action tone="danger" run={async () => { await command('reader.remove', {}); setCheck(null); await onChange() }}>Remove key</Action>
        <span className="hint">Saved by {saved.updated_by}, {day(saved.updated_at)}. The key is stored sealed and never shown again.</span>
      </div>}
      {check && <p role="status" className={check.ok ? 'tone-good' : 'error'}>{check.message}</p>}
    </>}
  </Card></section>
}

function TryLocally({ onDone }: { onDone: () => Promise<void> }) {
  const [result, setResult] = useState('')
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget
    const response = await fetch('/api/pantry/receipts/try-email', { method: 'POST', body: new FormData(form) })
    const value = await response.json().catch(() => ({})) as D
    setResult(!response.ok ? value.error ?? 'Pantry did not accept that message.' : value.result === 'received' ? 'Received. It is waiting in Receipts.' : value.result === 'confirmation' ? 'That was a forwarding confirmation; its code is shown above.' : value.reason)
    form.reset(); await onDone()
  }}>
    <div className="inline-form"><div className="field"><label htmlFor="try-eml">Saved email (.eml)</label><input id="try-eml" type="file" name="message" accept=".eml,message/rfc822" required /></div>
      <div className="form-end"><button className="btn btn-secondary">Send to my Pantry address</button></div></div>
    {result && <p role="status" className="hint">{result}</p>}
  </form>
}

function AddressCard({ inbox, onChange }: { inbox: D; onChange: () => Promise<void> }) {
  if (inbox.hosting === 'no-domain') return <section id="receipt-address"><Card title={<><Icon name="receipt" /> Forward receipts by email</>} actions={<Chip>Needs a domain</Chip>}>
    <p>Forwarding receipts by email needs a domain of your own. This Pantry runs on RER Managed hosting ({inbox.host}), which has none yet; photos and uploads work.</p>
  </Card></section>
  const create = <Form label={inbox.address ? 'Make a new address' : 'Create my Pantry address'} submit={b => command('receipt-address.create', b)} onDone={onChange} className="grid-form">
    <Field label="Receiving address you routed to Pantry" name="mailbox" defaultValue={inbox.mailbox ?? ''} required placeholder="receipts@example.com" hint="Pantry adds a private tag to it; only mail to the tagged address is kept." />
  </Form>
  return <section id="receipt-address"><Card title={<><Icon name="receipt" /> Forward receipts by email</>} actions={inbox.address ? <Chip tone="good">Receiving</Chip> : <Chip tone="warn">Not set up</Chip>}>
    {inbox.address ? <>
      <p>Forward receipt emails, or have your mail forward them automatically, to:</p>
      <p><code className="token">{inbox.address}</code> <button type="button" className="btn btn-link" onClick={() => navigator.clipboard?.writeText(inbox.address)}>Copy</button></p>
      <details className="details"><summary>Your domain has Subaddressing off?</summary><p className="hint">Pantry also accepts the same private address as <code className="token">{inbox.exactAddress}</code>. In Cloudflare Email Routing, create a rule for that exact address with <strong>Send to a Worker</strong> and forward to it instead; no Subaddressing needed.</p></details>
      <p className="hint">{inbox.lastReceivedAt ? <>Last received {day(inbox.lastReceivedAt)}: {inbox.lastNote}</> : 'Nothing received yet.'} Each message is kept whole; Pantry reads its PDF or photo, or its text when it has none.</p>
      {inbox.confirmation && <div className="callout callout-warn" role="status"><strong>Gmail asked to confirm forwarding{inbox.confirmation.account ? ` from ${inbox.confirmation.account}` : ''}</strong>
        <span>{inbox.confirmation.code ? <>Code <strong>{inbox.confirmation.code}</strong>. </> : null}Enter it in Gmail’s forwarding settings{inbox.confirmation.link ? <>, or <a href={inbox.confirmation.link} target="_blank" rel="noreferrer">open Google’s confirmation link</a></> : null}.</span></div>}
      {inbox.hosting === 'local' && <><p><strong>Running on this computer.</strong> Mail from the internet cannot reach it; once Pantry is deployed on your domain, mail to this address arrives on its own. To see it work now, save a receipt email as .eml (in Gmail: ⋮ › Download message) and send it here:</p><TryLocally onDone={onChange} /></>}
      <details className="details"><summary>Replace or remove the address</summary>
        <p className="hint">If the address was shared by mistake, make a new one: the old one stops reaching Pantry at once; receipts already received stay.</p>
        {create}
        <Action tone="danger" run={async () => { await command('receipt-address.remove', {}); await onChange() }}>Stop receiving by email</Action>
      </details>
    </> : <>
      <p>Do this once, with a domain in the Cloudflare account this Pantry runs on (about five minutes){inbox.host.endsWith('.workers.dev') ? <>; {inbox.host} itself cannot receive mail</> : null}:</p>
      <ol className="setup-steps">
        <li>In Cloudflare, open your domain, then <strong>Email</strong> › <strong>Email Routing</strong>, and turn it on (a spare subdomain such as <code>books.example.com</code> keeps your normal mail as it is).</li>
        <li>Under <strong>Routing rules</strong>, create the address <code>receipts@</code> your domain with the action <strong>Send to a Worker</strong>, and choose the Worker that serves {inbox.host}.</li>
        <li>Under <strong>Settings</strong>, turn on <strong>Subaddressing</strong>, so the private <code>receipts+tag@</code> address reaches the same rule. (To leave it off, skip this: once the address exists, this card shows a <code>receipts-tag@</code> spelling to route with its own rule.)</li>
        <li>Enter the address here and create your Pantry address.</li>
      </ol>
      {create}
    </>}
  </Card></section>
}

export function ReceiptSettings() {
  const { data, error, reload } = useView<D>('receipts/settings')
  if (!data) return <Card title="Receipts"><Loading error={error} what="receipt settings" /></Card>
  return <><ReadingCard reader={data.reader} onChange={reload} /><AddressCard inbox={data.inbox} onChange={reload} /></>
}
