// The accountant's reconciliation actions for these books. Client switching is
// independent; each installation enforces its own grants on the undo command.
import { Card, Chip, Table, day, usd, useShared, type D } from './kit'

export function ReconciliationReview({ data, open }: { data: D; open: (id: string) => void }) {
  const { state } = useShared()
  return <Card title="Accountant reconciliation review">
    <p>Review completed proofs or repair a reconciliation. Undoing an earlier proof lists every later reconciliation for one confirmation, newest first.</p>
    <Table heads={['Account', 'Statement ending', 'Closing balance', 'Status', '']} figures={[2]} empty="No statements to review.">
      {data.statements.map((s: D) => <tr key={s.id}>
        <td>{data.accounts.find((a: D) => a.id === s.bank_account_id)?.name}</td><td>{day(s.end_date)}</td><td className="fig">{usd(s.closing_cents)}</td>
        <td><Chip tone={s.reconciliation_id ? 'good' : 'warn'}>{s.reconciliation_id ? 'Reconciled' : 'Needs reconciliation'}</Chip></td>
        <td><button type="button" className="btn btn-secondary" onClick={() => open(s.id)}>{s.reconciliation_id && state.actor.can.reopen ? 'Review or undo' : 'Open statement'}</button></td>
      </tr>)}
    </Table>
  </Card>
}
