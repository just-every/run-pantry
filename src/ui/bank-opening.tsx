import { useState } from 'react'
import { command, Field, Form, type D } from './kit'

/** Opening evidence can be corrected until a reconciliation relies on it. */
export function BankOpening({ bank, onDone }: { bank: D; onDone: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  return editing ? <Form label="Correct opening balance" submit={b => command('bank-account.correct-opening', { id: bank.id, revision: bank.revision, ...b })}
    onDone={async () => { setEditing(false); await onDone() }} className="grid-form"
    secondary={<button type="button" className="btn btn-link" onClick={() => setEditing(false)}>Cancel</button>}>
    <Field label="Opening balance as of" name="openingDate" type="date" defaultValue={bank.opening_date} required hint="Use the day before the first statement starts. A September 1 statement opens with the August 31 balance." />
    <Field label="Opening statement balance" name="openingBalance" inputMode="decimal" defaultValue={(bank.opening_cents / 100).toFixed(2)} required />
    <Field label="Reason for correction" name="reason" required />
  </Form> : <button type="button" className="btn btn-link" onClick={() => setEditing(true)}>Correct opening balance</button>
}
