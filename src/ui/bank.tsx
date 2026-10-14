// Bank: accounts, statement imports (CSV or OFX) and the statements waiting to reconcile.
import { useRef, useState } from 'react'
import { Card, Chip, command, Field, Form, Loading, PageHead, Table, accountOptions, day, readFileText, usd, useShared, useView, type D } from './kit'
import { Reconcile } from './reconcile'

function Import({ accounts, onDone }: { accounts: D[]; onDone: () => Promise<void> }) {
  const file = useRef<HTMLInputElement>(null), [result, setResult] = useState<D | null>(null)
  return <Card title="Import a statement">
    <p className="hint">Download the statement from your bank as OFX (also called Web Connect or QFX) or CSV. Pantry checks the account it belongs to and skips lines it already has.</p>
    <Form label="Import statement" submit={async b => { const f = await readFileText(file.current); return command('statement.import', { ...b, fileName: f.name, content: f.content }) }} onDone={async r => { setResult(r); await onDone() }}>
      <div className="grid-form">
        <Field label="Bank account" name="bankAccountId" required options={accounts.map(a => ({ value: a.id, label: `${a.name} (…${a.number_last4})` }))} />
        <div className="field"><label htmlFor="statement-file">Statement file</label><input id="statement-file" ref={file} type="file" accept=".csv,.ofx,.qfx,.qbo" required /></div>
        <Field label="Opening balance on the statement" name="opening" inputMode="decimal" hint="Required for CSV; OFX files carry the closing balance" />
        <Field label="Closing balance on the statement" name="closing" inputMode="decimal" />
        <Field label="Statement start" name="start" type="date" /><Field label="Statement end" name="end" type="date" />
        <Field label="Last four digits (CSV only)" name="confirmLast4" inputMode="numeric" hint="CSV files do not name the account; confirm it" />
      </div>
    </Form>
    {result && <div className={`callout ${result.duplicate ? 'callout-warn' : 'callout-good'}`} role="status"><strong>{result.duplicate ? 'This file was already imported' : `Imported ${result.added} line${result.added === 1 ? '' : 's'}`}</strong><span>{result.duplicate ? 'No lines were added.' : `${result.duplicates} already in Pantry were skipped.`}{result.fileBalances && !result.fileBalances.agrees ? ` The file's lines total ${usd(result.fileBalances.lineTotal)}, which does not match its balances; reconciliation will show the difference.` : ''}</span></div>}
  </Card>
}

function NewBankAccount({ onDone }: { onDone: () => Promise<void> }) {
  const { state } = useShared(), used = new Set(state.bankAccounts.map((b: D) => b.account_id))
  return <Card title="Add a bank account"><Form label="Add bank account" submit={b => command('bank-account.save', b)} onDone={onDone} className="grid-form">
    <Field label="Name" name="name" required /><Field label="Bank" name="institution" required />
    <Field label="Ledger account" name="accountId" required options={accountOptions(state.accounts, a => a.subtype === 'bank' && !used.has(a.id))} hint="A bank account in your chart" />
    <Field label="Last four digits" name="numberLast4" required inputMode="numeric" />
    <Field label="Routing number (optional)" name="routing" inputMode="numeric" />
    <Field label="Opening statement date" name="openingDate" type="date" required /><Field label="Opening statement balance" name="openingBalance" required inputMode="decimal" />
  </Form></Card>
}

export function Bank() {
  const { data, error, reload } = useView<D>('bank'), shared = useShared()
  // The statement being reconciled lives in the address, so a reload or a shared link returns to it.
  const [statement, setStatement] = useState<string | null>(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('statement'))
  const open = (id: string | null) => { window.history.replaceState(null, '', id ? `?statement=${encodeURIComponent(id)}` : window.location.pathname); setStatement(id) }
  if (statement) return <Reconcile statementId={statement} back={async () => { open(null); await reload() }} />
  if (!data) return <Loading error={error} what="bank accounts" />
  const refresh = async () => { await reload(); await shared.reload() }
  return <>
    <PageHead title="Bank" lead="Statements are the bank's record. Match each line to your books and reconcile to the statement balance." />
    <div className="split split-wide-left split-bank">
      <div className="stack">
        <Card title="Bank accounts"><Table heads={['Account', 'Bank', 'Ledger account', 'Opening statement']} figures={[3]} empty="No bank accounts yet.">
          {data.accounts.map((a: D) => <tr key={a.id}><td>{a.name} <small className="sub">…{a.number_last4}</small></td><td>{a.institution}</td><td>{a.ledger_code} · {a.ledger_name}</td><td className="fig">{usd(a.opening_cents)} on {day(a.opening_date)}</td></tr>)}
        </Table></Card>
        <Card title="Statements"><Table heads={['Account', 'Period', 'Lines', 'Closing', 'Status', '']} figures={[2, 3]} empty="No statements imported yet.">
          {data.statements.map((s: D) => <tr key={s.id}><td>{data.accounts.find((a: D) => a.id === s.bank_account_id)?.name}</td><td className="nowrap">{day(s.start_date)} – {day(s.end_date)}</td><td className="fig">{s.line_count}{s.duplicate_count ? ` (+${s.duplicate_count} already in)` : ''}</td><td className="fig">{usd(s.closing_cents)}</td>
            <td>{s.reconciliation_id ? <Chip tone="good">Reconciled</Chip> : <Chip tone="warn">To reconcile</Chip>}</td><td><button type="button" className="btn btn-secondary" onClick={() => open(s.id)}>{s.reconciliation_id ? 'View' : 'Reconcile'}</button></td></tr>)}
        </Table></Card>
      </div>
      {shared.state.actor.can.record && <div className="stack">{data.accounts.length > 0 && <Import accounts={data.accounts} onDone={refresh} />}<NewBankAccount onDone={refresh} /></div>}
    </div>
  </>
}
