import { Action, command, usd, type D } from './kit'

export function DepositProposal({ proposal, canRecord, onDone }: { proposal?: D; canRecord: boolean; onDone: () => Promise<void> }) {
  if (!proposal) return null
  return <span className="filed" onClick={e => e.stopPropagation()}><small className="sub">{proposal.invoice} · {proposal.customer} · {usd(proposal.amount)}</small>
    {canRecord && <Action run={async () => { await command('deposit.confirm', { lineId: proposal.lineId, invoiceId: proposal.invoiceId }); await onDone() }}>Confirm payment</Action>}</span>
}
