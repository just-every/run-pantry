// Connected: Stripe payouts booked as sales, fees and refunds against the
// deposit, and Gusto payrolls posted as one entry against their debits. Each
// card is completed from this page and says plainly what this install can do.
import { ago } from './bank-feeds'
import { Action, Card, Chip, command, day, Field, Form, Loading, Table, today, usd, useShared, useView, type D } from './kit'

/** An amount in the payout's own currency; dollars need no label. */
const money = (c: number, currency = 'usd') => currency === 'usd' ? usd(c) : `${usd(c).replace('$', '')} ${currency.toUpperCase()}`

function matchState(m: D | null) {
  if (!m) return null
  const l = m.lines[0]
  return <>{m.automatic ? 'Matched automatically to' : 'Matched to'} {m.lines.length === 1 ? <>the {usd(Math.abs(l.amount_cents))} line on {day(l.posted_date)}</> : <>{m.lines.length} bank lines from {day(l.posted_date)}</>}</>
}

function PayoutStatus({ p }: { p: D }) {
  if (p.status === 'booked') return <>{p.match ? <Chip tone="good">Booked · matched</Chip> : <Chip tone="info">Booked · waiting for the deposit</Chip>}{p.match && <small className="sub block">{matchState(p.match)}</small>}</>
  if (p.status === 'other-currency') return <Chip tone="warn">Not booked: {String(p.currency).toUpperCase()}</Chip>
  return <><Chip tone="warn">Needs you</Chip><small className="sub block">{p.reason}</small></>
}

function PayoutSettings({ v, onDone }: { v: D; onDone: () => Promise<void> }) {
  const { state } = useShared(), s = v.settings
  const banks = state.bankAccounts.filter((b: D) => b.institution !== 'Stripe').map((b: D) => ({ value: b.id, label: `${b.name} (…${b.number_last4})` }))
  const income = state.accounts.filter((a: D) => a.active && a.type === 'income').map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))
  return <Form label={s.bank ? 'Save payout settings' : 'Book Stripe payouts'} submit={b => command('stripe.payouts', b)} onDone={onDone} className="grid-form">
    <Field label="Payouts land in" name="bankAccountId" required defaultValue={s.bank?.id ?? (banks.length === 1 ? banks[0].value : '')} options={banks} hint="The bank account Stripe pays out to" />
    <Field label="Sales go to" name="salesAccountId" required defaultValue={s.sales?.id ?? income[0]?.value} options={income} hint="For charges Pantry did not invoice; invoice payments are already in the books" />
    <Field label="Book payouts arriving from" name="from" type="date" required defaultValue={s.from ?? today().slice(0, 8) + '01'} />
  </Form>
}

function Payouts({ v, onDone }: { v: D; onDone: () => Promise<void> }) {
  const owner = useShared().state.actor.can.owner, can = useShared().state.actor.can.record, s = v.settings
  if (!v.available) return <Card title="Stripe payouts"><p className="hint">{v.reason}</p></Card>
  return <Card title="Stripe payouts" actions={s.bank && can && <Action run={async () => { await command('stripe.payouts-sync', {}); await onDone() }}>Read payouts now</Action>}>
    <p>Each payout is split into gross sales, Stripe fees and refunds, posted as one entry, and matched to its deposit when the bank line arrives. Reading a payout again never books it twice.</p>
    {s.bank ? <dl className="facts">
      <div><dt>Lands in</dt><dd>{s.bank.name} (…{s.bank.number_last4})</dd></div>
      <div><dt>Posted to</dt><dd>{s.sales.code} {s.sales.name} · {s.fees.code} {s.fees.name} · {s.refunds.code} {s.refunds.name}</dd></div>
      <div><dt>From</dt><dd>Payouts arriving on or after {day(s.from)}</dd></div>
      <div><dt>Last read</dt><dd>{ago(s.syncedAt)}{s.error ? ` · ${s.error}` : ''}</dd></div>
    </dl> : !owner && <p className="hint">The owner chooses where payouts land.</p>}
    {v.currency !== 'usd' && <div className="callout callout-warn" role="status"><strong>This Stripe account pays out in {String(v.currency).toUpperCase()}</strong><span>Pantry keeps US-dollar books, so it shows these payouts split but books only payouts in US dollars.</span></div>}
    {owner && (s.bank ? <details className="details"><summary>Change payout settings</summary><PayoutSettings v={v} onDone={onDone} /></details> : <PayoutSettings v={v} onDone={onDone} />)}
    {s.bank && <Table heads={['Arrives', 'Payout', 'Charges', 'Gross sales', 'Fees', 'Refunds', 'Status']} figures={[1, 2, 3, 4, 5]} empty="No paid payouts since the start date yet.">
      {v.payouts.map((p: D) => <tr key={p.id}><td className="nowrap">{day(p.arrival_date)}</td><td className="fig">{money(p.amount_cents, p.currency)}</td><td className="fig">{p.charges}</td><td className="fig">{money(p.gross_cents, p.currency)}{p.invoiced_cents ? <small className="sub"> {money(p.invoiced_cents, p.currency)} invoiced</small> : null}</td>
        <td className="fig">{money(p.fee_cents, p.currency)}</td><td className="fig">{money(p.refund_cents, p.currency)}</td><td><PayoutStatus p={p} /></td></tr>)}
    </Table>}
  </Card>
}

function GustoSettings({ g, onDone }: { g: D; onDone: () => Promise<void> }) {
  const { state } = useShared(), c = g.connected
  const banks = state.bankAccounts.filter((b: D) => b.institution !== 'Stripe').map((b: D) => ({ value: b.id, label: `${b.name} (…${b.number_last4})` }))
  return <Form label={c.bank ? 'Save payroll settings' : 'Post payrolls'} submit={b => command('gusto.settings', b)} onDone={onDone} className="grid-form">
    <Field label="Gusto debits" name="bankAccountId" required defaultValue={c.bank?.id} options={banks} hint="The bank account Gusto takes net pay and taxes from" />
    <Field label="Post payrolls paid from" name="from" type="date" required defaultValue={c.from} />
  </Form>
}

function Payroll({ g, onDone }: { g: D; onDone: () => Promise<void> }) {
  const owner = useShared().state.actor.can.owner, can = useShared().state.actor.can.record, c = g.connected, a = g.availability
  const failed = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('gusto_error')
  if (!a.available && !c) return <Card title="Payroll (Gusto)"><p className="hint">{a.reason}</p></Card>
  return <div id="payroll"><Card title="Payroll (Gusto)" actions={c?.bank && a.available && can && <Action run={async () => { await command('gusto.sync', {}); await onDone() }}>Read payrolls now</Action>}>
    <p>Each processed Gusto payroll posts as one balanced entry on its check date: gross wages and employer taxes, the taxes and deductions withheld, and net pay. Pantry matches it to Gusto's bank debits when they arrive.</p>
    {failed && <div className="callout callout-warn" role="alert"><strong>Gusto did not connect</strong><span>{failed}</span></div>}
    {!a.available && <p className="hint">{a.reason}</p>}
    {c ? <>
      <dl className="facts">
        <div><dt>Company</dt><dd>{c.company}</dd></div>
        <div><dt>Debits</dt><dd>{c.bank ? `${c.bank.name} (…${c.bank.number_last4})` : 'Choose the bank account Gusto debits'}</dd></div>
        <div><dt>Posted to</dt><dd>{c.accounts.wages.code} {c.accounts.wages.name} · {c.accounts.taxes.code} {c.accounts.taxes.name} · {c.accounts.liabilities.code} {c.accounts.liabilities.name}</dd></div>
        <div><dt>From</dt><dd>Payrolls paid on or after {day(c.from)}</dd></div>
        <div><dt>Last read</dt><dd>{ago(c.syncedAt)}{c.error ? ` · ${c.error}` : ''}</dd></div>
      </dl>
      {owner && (c.bank ? <details className="details"><summary>Change payroll settings</summary><GustoSettings g={g} onDone={onDone} /></details> : <GustoSettings g={g} onDone={onDone} />)}
      <Table heads={['Paid', 'Gross wages', 'Employer taxes', 'Withheld', 'Net pay', 'Debited', 'Status']} figures={[1, 2, 3, 4, 5]} empty="No processed payrolls since the start date yet.">
        {g.payrolls.map((p: D) => <tr key={p.uuid}><td className="nowrap">{day(p.check_date)}{p.off_cycle ? <small className="sub"> off-cycle</small> : null}</td><td className="fig">{usd(p.gross_cents)}</td><td className="fig">{usd(p.employer_tax_cents)}</td><td className="fig">{usd(p.withheld_cents)}</td><td className="fig">{usd(p.net_cents)}</td><td className="fig">{usd(p.debit_cents)}</td>
          <td>{p.status === 'booked' ? <>{p.match ? <Chip tone="good">Posted · matched</Chip> : <Chip tone="info">Posted · waiting for the debit</Chip>}{p.match && <small className="sub block">{matchState(p.match)}</small>}</>
            : <><Chip tone="warn">Needs you</Chip><small className="sub block">{p.reason}</small></>}</td></tr>)}
      </Table>
      {owner && <Action tone="danger" run={async () => { if (window.confirm(`Disconnect Gusto? Payrolls already posted stay.`)) { await command('gusto.disconnect', {}); await onDone() } }}>Disconnect Gusto</Action>}
    </> : owner ? <>
      <ol className="how-to">
        <li>In Gusto's developer portal, add <code>{a.redirectUri}</code> as a redirect URI of this installation's Gusto app.</li>
        <li>Choose <strong>Connect Gusto</strong>, sign in to Gusto as a company admin and choose the company.</li>
        <li>Pantry adds Wages and salaries, Payroll taxes, Employee benefits, Employee reimbursements and Payroll liabilities to your chart and posts each processed payroll.</li>
      </ol>
      <Action tone="primary" run={async () => { const { url } = await command('gusto.connect', {}); window.location.assign(url) }}>Connect Gusto</Action>
    </> : <p className="hint">The owner connects Gusto.</p>}
  </Card></div>
}

export function ConnectedSettings() {
  const { data, error, reload } = useView<D>('connected'), shared = useShared()
  if (!data) return <Loading error={error} what="connected services" />
  const done = async () => { await Promise.all([reload(), shared.reload()]) }
  return <><Payouts v={data.payouts} onDone={done} /><Payroll g={data.gusto} onDone={done} /></>
}
