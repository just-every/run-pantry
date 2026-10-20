import { openLink } from './plaid-link'
import { useState } from 'react'
import { Action, Card, command, Field, Form, type D } from './kit'

/** Start reconciliation without uploading transactions that the feed already has. */
export function FeedStatement({ connections, onDone }: { connections: D[]; onDone: () => Promise<void> }) {
  const accounts = connections.flatMap(c => c.accounts).filter(a => a.bank_account_id)
  const [selected, setSelected] = useState(''), [statements, setStatements] = useState<D[]>([]), [pdf, setPdf] = useState(''), [listed, setListed] = useState(false), [start, setStart] = useState(''), [end, setEnd] = useState('')
  if (!accounts.length) return null
  return <Card title="Reconcile existing feed lines">
    <p>Enter the dates and balances printed on your statement. Existing matches stay in place.</p>
    <Field label="Connected account" name="feedAccount" value={selected} onChange={(e: any) => { setSelected(e.target.value); setStatements([]); setPdf(''); setListed(false) }} options={accounts.map(a => ({ value: a.id, label: a.bank_name || a.name }))} />
    {selected && <>
      <p>For first use, enter the statement dates below, then enable PDF access through your bank's Plaid Link. Statements may incur fees under your Plaid agreement.</p>
      <Action disabled={!start || !end} run={async () => {
        const result = await command('feed.statement-link', { feedAccountId: selected, start, end })
        if (await openLink(result.linkToken, `statements:${selected}`)) { const found = await command('feed.statements', { feedAccountId: selected }); setStatements(found.statements); setListed(true) }
      }}>Enable statement PDFs through Plaid</Action>
      <Action run={async () => { const result = await command('feed.statements', { feedAccountId: selected }); setStatements(result.statements); setListed(true) }}>Find Plaid statement PDFs</Action>
      {listed && !statements.length && <p>No statement PDFs are available for this account. You can enter balances from your own statement below.</p>}
      {statements.length > 0 && <Field label="Statement evidence" name="providerStatement" value={pdf} empty="Typed balances from my statement" onChange={(e: any) => setPdf(e.target.value)} options={statements.map(s => ({ value: s.statement_id, label: `${s.year}-${String(s.month).padStart(2, '0')}${s.date_posted ? ` · posted ${s.date_posted}` : ''}` }))} />}
      {pdf && <p>Pantry downloads and keeps the original PDF with its SHA-256. Enter its printed period and balances; Plaid does not return parsed balances.</p>}
      <Form label="Start reconciliation" submit={b => command('statement.from-feed', { ...b, feedAccountId: selected, providerStatementId: pdf || undefined })} onDone={onDone} className="grid-form">
        <Field label="Statement start" name="start" type="date" required value={start} onChange={(e: any) => setStart(e.target.value)} /><Field label="Statement end" name="end" type="date" required value={end} onChange={(e: any) => setEnd(e.target.value)} />
        <Field label="Printed opening balance" name="opening" inputMode="decimal" required /><Field label="Printed closing balance" name="closing" inputMode="decimal" required />
      </Form>
    </>}
  </Card>
}
