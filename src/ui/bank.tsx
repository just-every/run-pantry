// Bank: transactions from feeds and statement files, the rules that file them,
// and accounts, statement imports (CSV or OFX) and the statements waiting to reconcile.
import { useRef, useState } from 'react'
import { Card, Chip, command, Field, Form, Loading, PageHead, Table, Tabs, accountOptions, day, readFileText, usd, useShared, useView, type D } from './kit'
import { Reconcile } from './reconcile'
import { Suggestions, Transactions } from './bank-lines'
import { Rules, fromSuggestion, type Draft } from './bank-rules'
import { Feeds, RelinkNotices } from './bank-feeds'

function Import({ accounts, onDone }: { accounts: D[]; onDone: () => Promise<void> }) {
  const file = useRef<HTMLInputElement>(null), [result, setResult] = useState<D | null>(null)
  return <Card title="Import a statement">
    <p className="hint">Download the statement from your bank as OFX (also called Web Connect or QFX) or CSV. Pantry checks the account it belongs to and skips lines it already has.</p>
    {!accounts.length ? <p>First add the bank or card account the statement is from, below; then choose the file here.</p> : <Form label="Import statement" submit={async b => { const f = await readFileText(file.current); return command('statement.import', { ...b, fileName: f.name, content: f.content }) }} onDone={async r => { setResult(r); await onDone() }}>
      <div className="grid-form">
        <Field label="Bank account" name="bankAccountId" required options={accounts.map(a => ({ value: a.id, label: `${a.name} (…${a.number_last4})` }))} />
        <div className="field"><label htmlFor="statement-file">Statement file</label><input id="statement-file" ref={file} type="file" accept=".csv,.ofx,.qfx,.qbo" required /></div>
        <Field label="Opening balance on the statement" name="opening" inputMode="decimal" hint="Required for CSV; OFX files carry the closing balance" />
        <Field label="Closing balance on the statement" name="closing" inputMode="decimal" />
        <Field label="Statement start" name="start" type="date" /><Field label="Statement end" name="end" type="date" />
        <Field label="Last four digits (CSV only)" name="confirmLast4" inputMode="numeric" hint="CSV files do not name the account; confirm it" />
      </div>
    </Form>}
    {result && <div className={`callout ${result.duplicate ? 'callout-warn' : 'callout-good'}`} role="status"><strong>{result.duplicate ? 'This file was already imported' : `Imported ${result.added} line${result.added === 1 ? '' : 's'}`}</strong><span>{result.duplicate ? 'No lines were added.' : `${result.duplicates} already in Pantry were skipped.${result.fromFeed ? ` ${result.fromFeed} came in from the feed already and joined this statement.` : ''}${result.filedByRule ? ` ${result.filedByRule} filed by your rules.` : ''}`}{result.fileBalances && !result.fileBalances.agrees ? ` The file's lines total ${usd(result.fileBalances.lineTotal)}, which does not match its balances; reconciliation will show the difference.` : ''}</span></div>}
    {result && <AutomaticResult automatic={result.automatic} />}
  </Card>
}

/** What the import matched by itself, and the deposits it left for a person. */
function AutomaticResult({ automatic }: { automatic?: D }) {
  if (!automatic) return null
  return <>
    {automatic.matched.length > 0 && <div className="callout callout-good" role="status"><strong>{automatic.matched.length} deposit{automatic.matched.length === 1 ? '' : 's'} matched automatically</strong><span>{automatic.matched.map((m: D) => `${usd(m.amount)} from ${m.customer} paid ${m.invoice}`).join('; ')}. Each can be undone on the reconciliation screen.</span></div>}
    {automatic.needsPerson.length > 0 && <div className="callout callout-warn" role="status"><strong>{automatic.needsPerson.length} deposit{automatic.needsPerson.length === 1 ? '' : 's'} need{automatic.needsPerson.length === 1 ? 's' : ''} you</strong><span>{automatic.needsPerson.map((m: D) => `${m.description}: ${m.reason}`).join(' · ')}</span></div>}
  </>
}

function NewBankAccount({ onDone }: { onDone: () => Promise<void> }) {
  const { state } = useShared(), used = new Set(state.bankAccounts.map((b: D) => b.account_id))
  return <Card title="Add a bank or card account"><Form label="Add bank account" submit={b => command('bank-account.save', b)} onDone={onDone} className="grid-form">
    <Field label="Name" name="name" required /><Field label="Bank" name="institution" required />
    <Field label="Ledger account" name="accountId" required options={accountOptions(state.accounts, a => a.subtype === 'bank' && !used.has(a.id))} hint="A bank or card account in your chart" />
    <Field label="Last four digits" name="numberLast4" required inputMode="numeric" />
    <Field label="Routing number (optional)" name="routing" inputMode="numeric" />
    <Field label="Opening statement date" name="openingDate" type="date" required /><Field label="Opening statement balance" name="openingBalance" required inputMode="decimal" />
  </Form></Card>
}

const TABS = ['Transactions', 'Rules', 'Statements'] as const

function Statements({ data, refresh, open }: { data: D; refresh: () => Promise<void>; open: (id: string) => void }) {
  const shared = useShared()
  return <div className="split split-wide-left split-bank">
    <div className="stack">
      <Card title="Bank and card accounts"><Table heads={['Account', 'Bank', 'Ledger account', 'Opening statement']} figures={[3]} empty="No bank accounts yet.">
        {data.accounts.map((a: D) => <tr key={a.id}><td>{a.name} <small className="sub">…{a.number_last4}</small></td><td>{a.institution}</td><td>{a.ledger_code} · {a.ledger_name}</td><td className="fig">{usd(a.opening_cents)} on {day(a.opening_date)}</td></tr>)}
      </Table></Card>
      <Card title="Statements"><Table heads={['Account', 'Period', 'Lines', 'Closing', 'Status', '']} figures={[2, 3]} empty="No statements imported yet.">
        {data.statements.map((s: D) => <tr key={s.id}><td>{data.accounts.find((a: D) => a.id === s.bank_account_id)?.name}</td><td className="nowrap">{day(s.start_date)} – {day(s.end_date)}</td><td className="fig">{s.line_count}{s.duplicate_count ? ` (+${s.duplicate_count} already in)` : ''}</td><td className="fig">{usd(s.closing_cents)}</td>
          <td>{s.reconciliation_id ? <Chip tone="good">Reconciled</Chip> : <Chip tone="warn">To reconcile</Chip>}</td><td><button type="button" className="btn btn-secondary" onClick={() => open(s.id)}>{s.reconciliation_id ? 'View' : 'Reconcile'}</button></td></tr>)}
      </Table></Card>
    </div>
    {shared.state.actor.can.record && <div className="stack" id="import"><Import accounts={data.accounts} onDone={refresh} /><NewBankAccount onDone={refresh} /></div>}
  </div>
}

export function Bank() {
  const { data, error, reload } = useView<D>('bank'), lines = useView<D>('bank/lines'), rules = useView<D>('bank/rules'), feeds = useView<D>('bank/feeds'), shared = useShared()
  const query = () => typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)
  // The tab and the statement being reconciled live in the address, so a reload or a shared link returns to them.
  const [statement, setStatement] = useState<string | null>(() => query().get('statement'))
  const [tab, setTab] = useState<string>(() => TABS.find(t => t.toLowerCase() === query().get('tab')) ?? 'Transactions')
  const [draft, setDraft] = useState<Draft | null>(null)
  const go = (t: string) => { window.history.replaceState(null, '', t === 'Transactions' ? window.location.pathname : `?tab=${t.toLowerCase()}`); setTab(t) }
  const reconcile = (id: string | null) => { window.history.replaceState(null, '', id ? `?statement=${encodeURIComponent(id)}` : '?tab=statements'); setStatement(id) }
  if (statement) return <Reconcile statementId={statement} back={async () => { reconcile(null); setTab('Statements'); await reload() }} />
  if (!data) return <Loading error={error} what="bank accounts" />
  const refresh = async () => { await Promise.all([reload(), lines.reload(), rules.reload(), feeds.reload(), shared.reload()]) }
  // Importing lives on Statements: open it and bring the import card into view.
  const importStatement = () => { go('Statements'); requestAnimationFrame(() => document.getElementById('import')?.scrollIntoView({ block: 'start' })) }
  return <>
    <PageHead title="Bank" lead="Transactions arrive from your bank and card feeds or statement files. Rules file the routine ones; you file the rest and reconcile to the statement." />
    <RelinkNotices data={feeds.data} onDone={refresh} />
    <Tabs tabs={[...TABS]} current={tab} onChange={go} />
    {tab === 'Transactions' && <div className="split split-wide-left split-bank">
      <div className="stack"><Suggestions items={rules.data?.suggestions ?? []} onPick={s => { setDraft(fromSuggestion(s)); go('Rules') }} /><Transactions data={lines.data} onDone={refresh} feeds={!!feeds.data?.availability.available} /></div>
      <div className="stack"><Feeds data={feeds.data} onDone={refresh} onImport={importStatement} /></div>
    </div>}
    {tab === 'Rules' && <Rules data={rules.data} draft={draft} setDraft={setDraft} onDone={refresh} />}
    {tab === 'Statements' && <Statements data={data} refresh={refresh} open={reconcile} />}
  </>
}
