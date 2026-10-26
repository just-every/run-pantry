import { Action, Table, command, day, type D } from './kit'
import { DeliveryChip } from './invoice-delivery'

export function PaymentReceiptPreference({ enabled, customerId, onChange }: { enabled: boolean; customerId?: string; onChange: () => Promise<void> }) {
  return <div className="stack">
    <p>Automatic payment receipts are {enabled ? 'on' : 'off'} for {customerId ? 'this customer' : 'the business'}. Bank processing and returned-payment notices still go out.</p>
    <Action run={async () => { await command('payment.receipts-preference', { customerId, enabled: !enabled }); await onChange() }}>Turn payment receipts {enabled ? 'off' : 'on'}</Action>
  </div>
}

export function PaymentNoticeHistory({ notices }: { notices: D[] }) {
  return <Table heads={['Message', 'Recipient', 'When', 'Outcome']} empty="No payment messages yet.">
    {notices.map(n => <tr key={n.id}>
      <td data-label="Message">{n.kind === 'receipt' ? 'Payment receipt' : n.kind === 'processing' ? 'Bank payment processing' : 'Payment returned — invoice open again'}</td>
      <td data-label="Recipient">{n.recipient}</td>
      <td data-label="When">{day(n.at)}</td>
      <td data-label="Outcome"><DeliveryChip status={n.status} />{n.detail && <p className="hint">{n.detail}</p>}</td>
    </tr>)}
  </Table>
}

/** Render only inside the native banking grant, beside the allocated payment. */
export function SendPaymentReceipt({ paymentId, invoiceId, onChange }: { paymentId: string; invoiceId: string; onChange: () => Promise<void> }) {
  return <Action run={async () => { await command('payment.receipt', { paymentId, invoiceId }); await onChange() }}>Send payment receipt</Action>
}
