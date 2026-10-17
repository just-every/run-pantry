// How to give this installation its own provider account, on the page that needs it: what account to
// create (Pantry comes with none), where its keys are, the exact lines to paste, and how those lines reach
// Pantry on this computer (.dev.vars) or hosted (rer deploy --set-secret). The docs carry the same steps.
import { useState, type ReactNode } from 'react'

export type Provider = 'plaid' | 'gusto' | 'xero' | 'mail'

const DOCS = 'https://run-pantry.com/docs/connections'
const ext = (href: string, text?: string) => <a href={href} target="_blank" rel="noreferrer">{text ?? href.replace(/^https:\/\//, '')}</a>

type Choice = 'resend' | 'sendgrid'
type Guide = { account: string; steps: (origin: string, choice: Choice) => ReactNode[]; lines: (origin: string, choice: Choice) => [string, string][]; anchor: string; deployOnly?: boolean; choices?: [Choice, string][] }
const hostedOrigin = (origin: string) => origin.startsWith('https://')

const GUIDES: Record<Provider, Guide> = {
  plaid: {
    account: 'Plaid connects Pantry to your bank; Pantry never sees your bank password. Signing up with Plaid is free.',
    steps: origin => [
      <>Sign up at {ext('https://dashboard.plaid.com/signup')} with your business details.</>,
      <>Open {ext('https://dashboard.plaid.com/developers/keys', 'Developers → Keys')} and copy your <strong>client_id</strong> and the <strong>Sandbox</strong> secret. Sandbox connects Plaid's test banks only (sign in with <code>user_good</code> / <code>pass_good</code>), so you can try it first.</>,
      <>For your real bank, request <strong>Production</strong> access in the Plaid Dashboard. Plaid reviews your business first, which can take a few days. Once it approves, copy the Production secret and set <code>PLAID_ENV=production</code>.</>,
      <>Banks that sign you in on their own site (Chase, for one) need a return address: in Plaid's {ext('https://dashboard.plaid.com/developers/api', 'Developers → API')}, add <code>{origin}/app/bank/connect</code> under Allowed redirect URIs and set it as <code>PLAID_REDIRECT_URI</code>. Plaid accepts only https addresses there in Production, so this works on a hosted Pantry.</>,
    ],
    lines: origin => [['PLAID_CLIENT_ID', 'your client_id'], ['PLAID_SECRET', 'the Sandbox or Production secret'], ['PLAID_ENV', 'sandbox'], ...(hostedOrigin(origin) ? [['PLAID_REDIRECT_URI', `${origin}/app/bank/connect`] as [string, string]] : [])],
    anchor: 'bank-feeds-plaid',
  },
  gusto: {
    account: 'The developer app is separate from your Gusto payroll account, and free. It lets this Pantry read your processed payrolls.',
    steps: origin => [
      <>Sign up at {ext('https://dev.gusto.com')} and choose <strong>Create an application</strong>.</>,
      <>Add <code>{origin}/api/pantry/gusto/callback</code> as the application's redirect URI.</>,
      <>Copy the application's <strong>Client ID</strong> and <strong>Secret</strong>.</>,
      <>Gusto starts every application on its demo environment, with test companies. To bring in your real payroll, ask Gusto to approve the application for production, then set <code>GUSTO_ENV=production</code>.</>,
    ],
    lines: () => [['GUSTO_CLIENT_ID', 'the Client ID'], ['GUSTO_CLIENT_SECRET', 'the Secret'], ['GUSTO_ENV', 'demo']],
    anchor: 'payroll-gusto',
  },
  xero: {
    account: 'You make the app with your own Xero login; it is free and takes a few minutes. Pantry asks Xero only to read invoices, bills and their attachments.',
    steps: origin => [
      <>Sign in at {ext('https://developer.xero.com/app/manage')} with your Xero login and choose <strong>New app</strong>.</>,
      <>Choose <strong>Web app</strong>. Give it any name, <code>{origin}</code> as the company or application URL, and <code>{origin}/api/pantry/xero/callback</code> as the redirect URI.</>,
      <>Create the app. Under <strong>Configuration</strong>, copy the <strong>Client id</strong>, then choose <strong>Generate a secret</strong> and copy it.</>,
    ],
    lines: () => [['XERO_CLIENT_ID', 'the Client id'], ['XERO_CLIENT_SECRET', 'the secret']],
    anchor: 'attachments-xero',
  },
  mail: {
    account: 'A hosted Pantry emails invoices, reminders and sign-in links through a mail provider account of your own, Resend or SendGrid. Pantry does not come with one; you set it up before you put Pantry online.',
    choices: [['resend', 'Resend'], ['sendgrid', 'SendGrid']],
    steps: (_, choice) => choice === 'resend' ? [
      <>You send from a domain of your own, such as <code>yourbusiness.com</code>. No domain yet? Buy one from any registrar, or in Cloudflare under <strong>Domain Registration → Register Domains</strong>, which also puts it on your Cloudflare account.</>,
      <>Sign up at {ext('https://resend.com/signup', 'resend.com')}.</>,
      <>Open {ext('https://resend.com/domains', 'Domains')}, choose <strong>Add Domain</strong> and enter your domain. Add the DNS records it shows wherever your domain's DNS is managed (on Cloudflare: your domain → <strong>DNS → Records</strong>), then choose <strong>Verify DNS Records</strong> and wait until it says <strong>Verified</strong>.</>,
      <>Open {ext('https://resend.com/api-keys', 'API Keys')}, choose <strong>Create API Key</strong> with <strong>Sending access</strong>, and copy it.</>,
      <>Choose the address mail comes from, at that domain, for example <code>billing@example.com</code>. Write the address alone, with no name: <code>rer deploy</code> refuses <code>Your Business &lt;billing@…&gt;</code>. Invoices and reminders show your business's legal name as the sender, and sign-in and invitation emails show Pantry.</>,
    ] : [
      <>You send from a domain of your own, such as <code>yourbusiness.com</code>. No domain yet? Buy one from any registrar, or in Cloudflare under <strong>Domain Registration → Register Domains</strong>, which also puts it on your Cloudflare account.</>,
      <>Sign up at {ext('https://signup.sendgrid.com', 'sendgrid.com')}.</>,
      <>Open {ext('https://app.sendgrid.com/settings/sender_auth', 'Settings → Sender Authentication')} and choose <strong>Authenticate Your Domain</strong>. Enter your domain, add the DNS records it shows wherever your domain's DNS is managed (on Cloudflare: your domain → <strong>DNS → Records</strong>), then choose <strong>Verify</strong> and wait until it says <strong>Verified</strong>.</>,
      <>Open {ext('https://app.sendgrid.com/settings/api_keys', 'Settings → API Keys')}, choose <strong>Create API Key</strong>, pick <strong>Restricted Access</strong> with <strong>Mail Send</strong> set to <strong>Full Access</strong>, and copy the key. SendGrid shows it once.</>,
      <>Choose the address mail comes from, at that domain, for example <code>billing@example.com</code>. Write the address alone, with no name: <code>rer deploy</code> refuses <code>Your Business &lt;billing@…&gt;</code>. Invoices and reminders show your business's legal name as the sender, and sign-in and invitation emails show Pantry.</>,
    ],
    lines: (_, choice) => [['MAIL_PROVIDER', choice], ['MAIL_API_KEY', 'the API key'], ['MAIL_FROM', 'billing@example.com']],
    anchor: 'mail',
    deployOnly: true,
  },
}

const onThisComputer = (origin: string) => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) } catch { return false } }

/** The setup steps behind a disclosure, for the owner (who holds this installation's keys); others see who sets it up. */
export function SetupSteps({ provider, reason, summary, owner, open = false }: { provider: Provider; reason: string; summary: string; owner: boolean; open?: boolean }) {
  if (!owner) return <><p className="hint">{reason}</p><p className="hint">The owner of this Pantry sets it up.</p></>
  return <><p className="hint">{reason}</p><details className="setup-steps" open={open}><summary>{summary}</summary><ProviderSetup provider={provider} /></details></>
}

/** The steps to set up one provider for this installation. `reason` is the server's one line about what is missing. */
export function ProviderSetup({ provider, reason }: { provider: Provider; reason?: string }) {
  const g = GUIDES[provider], origin = typeof window === 'undefined' ? '' : window.location.origin
  const [choice, setChoice] = useState<Choice>(g.choices?.[0][0] ?? 'resend')
  const local = onThisComputer(origin) && !g.deployOnly
  const lines = g.lines(origin, choice), names = lines.map(([k]) => k)
  return <div className="provider-setup">
    {reason && <p>{reason}</p>}
    <p className="hint">{g.account}</p>
    {g.choices && <fieldset className="choices provider-choices"><legend>Your mail provider</legend>{g.choices.map(([value, label]) => <label key={value} className={`choice${choice === value ? ' picked' : ''}`}><input type="radio" name={`${provider}-choice`} value={value} checked={choice === value} onChange={() => setChoice(value)} /><strong>{label}</strong></label>)}</fieldset>}
    <ol className="how-to">
      {g.steps(origin, choice).map((s, i) => <li key={i}>{s}</li>)}
      <li>Put the keys in these lines, replacing each value:
        <pre className="env-lines"><code>{lines.map(([k, v]) => `${k}=${v}`).join('\n')}</code></pre></li>
      {local
        ? <li>In your <code>run-pantry</code> folder, open the file <code>.dev.vars</code> in a text editor (it already holds this Pantry's private settings). Its name starts with a dot, so Finder and file dialogs hide it: open it from a terminal in that folder with <code>open -e .dev.vars</code> on a Mac, <code>notepad .dev.vars</code> on Windows, or <code>nano .dev.vars</code> on Linux. Add the lines at the end and save. Then restart Pantry: <code>rer dev --stop</code>, then <code>rer dev</code>.</li>
        : g.deployOnly
          ? <li>Save the lines in a private file in your <code>run-pantry</code> folder, for example <code>.env.pantry</code>, and give it to the deploy: <code>chmod 600 .env.pantry</code>, then <code>rer deploy --env-file .env.pantry</code>. To change them later on a hosted Pantry, run <code>rer deploy --set-secret NAME --env-file .env.pantry</code> for each one.</li>
          : <li>On the computer you deploy Pantry from, save the lines in a private file in your <code>run-pantry</code> folder, for example <code>.env.pantry</code> (<code>chmod 600 .env.pantry</code>). Then give each one to this hosted Pantry, adding the same <code>--environment</code> you deployed with, if any: {names.map((n, i) => <span key={n}>{i ? ', ' : ''}<code>rer deploy --set-secret {n} --env-file .env.pantry</code></span>)}. They take effect at once, with no rebuild.</li>}
    </ol>
    <p className="hint">The same steps, with what each key does: {ext(`${DOCS}#${g.anchor}`, 'Connections and keys')}.</p>
  </div>
}
