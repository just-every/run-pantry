import { Link } from '@tanstack/react-router'
import { Card, Chip, Table, day, usd, type D } from './kit'

/** The provider snapshot is current evidence, separately labeled from the books. */
export function StripeClearing({ value }: { value: D | null | undefined }) {
  if (!value) return null
  const waiting = value.items.filter((item: D) => !['posted', 'adopted', 'legacy-covered', 'covered'].includes(item.status))
  return <Card title="Stripe clearing" actions={<Chip tone={value.ok ? 'good' : 'warn'}>{value.ok ? 'Matches provider' : 'Needs attention'}</Chip>}>
    <Table heads={['Ledger clearing', 'Stripe available + pending', 'Difference']} figures={[0, 1, 2]}>
      <tr><td className="fig">{usd(value.ledgerCents)}</td><td className="fig">{value.providerCents === null ? 'Not observed' : usd(value.providerCents)}</td><td className="fig">{value.differenceCents === null ? 'Not compared' : usd(value.differenceCents)}</td></tr>
    </Table>
    <p className="hint">{value.observedAt ? `Stripe balance observed ${day(value.observedAt)} (${value.observedAt}).` : 'No Stripe balance has been observed.'} This is the latest provider comparison, independent of the report date and cash/accrual display.</p>
    {value.reason && <p role="status">{value.reason}</p>}
    {!value.complete && <p role="status">The provider read is incomplete; this comparison cannot establish a tie.</p>}
    <Table heads={['Provider item', 'Date', 'Activity', 'Net', 'Status', 'Reason']} figures={[3]} caption="Stripe clearing evidence" empty="No unmatched provider items.">
      {waiting.map((item: D) => <tr key={item.id}><td>{item.id}{item.sourceId && <small className="sub block">{item.sourceId}</small>}</td><td>{day(item.date)}</td><td>{item.type}</td><td className="fig">{usd(item.netCents)}</td><td>{item.status}</td><td>{item.reason}{item.entryId && <> · <Link to="/app/reports" search={{ record: `entry:${item.entryId}` }}>Open posting</Link></>}</td></tr>)}
    </Table>
    <p className="row-actions"><Link to="/app/settings">Open Stripe settings</Link><a href="/api/pantry/stripe/clearing" download="stripe-clearing.json">Download comparison and item evidence</a></p>
  </Card>
}
