// Settings for invoices out: how reminders follow up, and connecting the
// business's own Stripe account so customers can pay by card or ACH from the
// invoice link. Each card says plainly what works on this install.
import { SetupSteps } from './provider-guides'
import { Action, Card, Chip, command, day, Field, Form, Loading, placeholderEmail, useShared, useView, type D } from './kit'

const ZONE_LABEL: Record<string, string> = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii', 'America/Puerto_Rico': 'Atlantic (Puerto Rico)' }

function Sending({ s, onDone }: { s: D; onDone: () => Promise<void> }) {
  const owner = useShared().state.actor.can.owner
  const days = (s.reminder_days as number[]).map(d => d < 0 ? `${-d} day${d === -1 ? '' : 's'} before` : d === 0 ? 'on the due date' : `${d} day${d === 1 ? '' : 's'} after`).join(', ')
  return <Card title="Sending invoices and reminders">
    {s.mail === 'ready' ? <p>Invoices and reminders are emailed from <strong>{s.from}</strong>, with replies going to {s.reply_to || s.ownerEmail}.</p>
      : <><div className="callout callout-warn" role="status"><strong>{s.mail === 'local' ? 'This computer sends no email' : 'No mail provider is set up'}</strong><span>{s.mail === 'local' ? 'Pantry on your own computer records each send as "Not sent: local run". Invoices, reminders and sign-in links are emailed once Pantry is online with a mail provider account of your own.' : 'Invoices and reminders are recorded but not emailed until this Pantry has a mail provider account of its own.'}</span></div>
        <SetupSteps provider="mail" reason="" summary="Set up email for a hosted Pantry" owner={owner} /></>}
    <p>{s.reminders_on ? <>Reminders go {days || 'never (no days set)'}, and stop as soon as the invoice is paid.</> : 'Reminders are off.'} Days follow {ZONE_LABEL[s.time_zone] ?? s.time_zone} time.</p>
    {owner && <Form label="Save reminders" submit={b => command('sending.save', { ...b, remindersOn: b.remindersOn === 'on', revision: s.revision })} onDone={onDone} className="grid-form">
      <label className="check"><input type="checkbox" name="remindersOn" defaultChecked={!!s.reminders_on} /> Send reminders for unpaid invoices</label>
      <Field label="Reminder days" name="reminderDays" defaultValue={(s.reminder_days as number[]).join(', ')} hint="Days from the due date: -3 is three days before, 0 the due date, 7 a week after" />
      <Field label="Time zone" name="timeZone" defaultValue={s.time_zone} required options={(s.zones as string[]).map(z => ({ value: z, label: ZONE_LABEL[z] ?? z }))} />
      <Field label="Replies go to" name="replyTo" type="email" defaultValue={s.reply_to} hint={placeholderEmail(s.ownerEmail) ? 'Blank uses the owner\'s sign-in email' : `Blank uses the owner's address, ${s.ownerEmail}`} />
    </Form>}
  </Card>
}

function Stripe({ st, onDone }: { st: D; onDone: () => Promise<void> }) {
  const owner = useShared().state.actor.can.owner, c = st.connected
  if (st.managed) return <Card title="Online payments (Stripe)"><div className="callout callout-warn" role="status"><strong>Not available yet on RER Managed</strong><span>Managed installs cannot reach Stripe until RER adds a relay for provider connections. Customers see that online payment is not available yet; record their payments under Payments. A self-hosted install of Pantry can connect Stripe today.</span></div></Card>
  if (c) return <Card title="Online payments (Stripe)" actions={<Chip tone={c.livemode ? 'good' : 'info'}>{c.livemode ? 'Live' : 'Test mode'}</Chip>}>
    <p>Customers can pay {[c.card && 'by card', c.ach && 'by ACH bank debit'].filter(Boolean).join(' or ') || 'nothing online (both methods are off)'} from the invoice link. Payments land in the <strong>Stripe balance</strong> account and Stripe's fee is booked to <strong>Stripe fees</strong>.</p>
    {c.settlementCurrency !== 'usd' && <div className="callout callout-warn" role="status"><strong>This Stripe account settles in {String(c.settlementCurrency).toUpperCase()}</strong><span>Pantry keeps US-dollar books: payments are recorded at the invoice's dollar amount and each Stripe fee is booked in dollars at Stripe's own conversion rate for that charge. A US Stripe account settles in dollars and needs no conversion.</span></div>}
    <dl className="facts"><div><dt>Account</dt><dd>{c.account} ({c.accountId})</dd></div><div><dt>Key</dt><dd className="code">{c.keyHint}</dd></div>
      <div><dt>Confirmations</dt><dd>{c.webhook ? 'Stripe notifies Pantry the moment a payment completes.' : 'This install is not reachable from the internet, so Pantry confirms a payment when the customer returns from Stripe and checks again every few minutes.'}</dd></div>
      <div><dt>Connected</dt><dd>{day(c.connectedAt)}</dd></div></dl>
    {owner && <Form label="Save payment methods" submit={b => command('stripe.methods', { card: b.card === 'on', ach: b.ach === 'on' })} onDone={onDone}>
      <label className="check"><input type="checkbox" name="card" defaultChecked={c.card} /> Card</label>
      {c.country === 'US' ? <label className="check"><input type="checkbox" name="ach" defaultChecked={c.ach} /> ACH bank debit (US bank accounts; takes a few business days to clear)</label>
        : <p className="hint">ACH bank debit is not offered: Stripe provides it only to US Stripe accounts, and this one is in {c.country}.</p>}
    </Form>}
    {owner && <Action tone="danger" run={async () => { await command('stripe.disconnect', {}); await onDone() }}>Disconnect Stripe</Action>}
  </Card>
  return <Card title="Online payments (Stripe)">
    <p>Let customers pay by card or ACH bank debit from the invoice link. The money goes to your own Stripe account; Pantry records the payment against the invoice and books Stripe's fee.</p>
    {owner ? <>
      <ol className="how-to">
        <li>Sign in at <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">dashboard.stripe.com/apikeys</a> (Developers → API keys). To try it first, switch the dashboard to Test mode.</li>
        <li>Under Standard keys, reveal and copy the <strong>Secret key</strong>. It starts with <code>sk_live_</code>, or <code>sk_test_</code> in test mode.</li>
        <li>Paste it below. Pantry checks it with Stripe, {st.publicOrigin ? 'adds a webhook so payments confirm the moment they complete,' : 'confirms payments when customers return from Stripe (this install is not reachable from the internet, so Stripe cannot call it),'} and adds two accounts to your chart: Stripe balance and Stripe fees.</li>
      </ol>
      <Form label="Connect Stripe" submit={b => command('stripe.connect', b)} onDone={onDone}>
        <Field label="Stripe secret key" name="secretKey" type="password" autoComplete="off" required hint="Kept encrypted in your books' database. A restricted key (rk_…) also works if it may read the account, payment intents, charges and balance transactions, and write Checkout Sessions and webhook endpoints." />
      </Form>
    </> : <p className="hint">The owner connects Stripe.</p>}
  </Card>
}

export function InvoicingSettings() {
  const { data, error, reload } = useView<D>('invoicing')
  if (!data) return <Loading error={error} what="invoice settings" />
  return <><Sending s={data.sending} onDone={reload} /><Stripe st={data.stripe} onDone={reload} /></>
}
