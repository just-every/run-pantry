import { Action, command, usd, type D } from './kit'

export function RecordedPaymentProposal({ offers, canRecord, onDone }: { offers?: D[]; canRecord: boolean; onDone: () => Promise<void> }) {
  if (!offers?.length) return null
  return <span className="filed" onClick={e => e.stopPropagation()}>{offers.map(p => <span key={p.paymentId}>
    <small className="sub">Recorded payment · {p.vendor} · {p.reference} · {usd(Math.abs(p.amount))}{p.card_last4 ? ` · card ••${p.card_last4}` : ''}</small>
    {canRecord && <Action run={async () => { await command('match.approve', { bankLineIds: [p.lineId], journalLineIds: [p.journalLineId], create: [] }); await onDone() }}>{p.direction === 'received' ? 'Match recorded payment' : 'Match bill payment'}</Action>}
  </span>)}</span>
}
