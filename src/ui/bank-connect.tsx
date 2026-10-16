// Connect a bank or card, start to finish on one page: sign in through Plaid
// Link, choose which Pantry bank account each of the institution's accounts
// feeds (an existing one, a new one, or none), then the first transactions arrive.
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Card, Chip, command, Field, Loading, PageHead, accountOptions, today, usd, useShared, useView, type D } from './kit'
import { openLink, pendingLink } from './plaid-link'

type Choice = { target: string; name: string; ledger: string; openingDate: string; openingBalance: string }
const CREATE = 'create'

/** The next free code in a hundred, for a ledger account made on this page. */
const nextCode = (accounts: D[], base: number, taken: string[]) => {
  for (let n = base; n < base + 100; n++) if (!accounts.some(a => a.code === String(n)) && !taken.includes(String(n))) return String(n)
  return String(base + 99)
}

function Choose({ connection, onDone }: { connection: D; onDone: (r: D) => void }) {
  const { state, reload } = useShared()
  const mapped = new Set<string>()
  const free = state.bankAccounts.filter((b: D) => !mapped.has(b.id))
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(connection.accounts.map((a: D) => {
    const same = free.find((b: D) => b.number_last4 === a.mask)
    const balance = a.balance_cents === null ? '' : ((a.kind.startsWith('credit') ? -a.balance_cents : a.balance_cents) / 100).toFixed(2)
    return [a.id, { target: a.bank_account_id ?? same?.id ?? '', name: a.name, ledger: CREATE, openingDate: today(), openingBalance: balance }]
  })))
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const set = (id: string, patch: Partial<Choice>) => setChoices(c => ({ ...c, [id]: { ...c[id], ...patch } }))
  const used = new Set(state.bankAccounts.map((b: D) => b.account_id))
  const ledgers = accountOptions(state.accounts, a => a.subtype === 'bank' && !used.has(a.id))
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const codes: string[] = [], accounts = []
      for (const a of connection.accounts as D[]) {
        const c = choices[a.id]
        if (c.target !== 'new') { accounts.push({ id: a.id, bankAccountId: c.target }); continue }
        let ledger = c.ledger
        if (ledger === CREATE) {
          const card = a.kind.startsWith('credit'), code = nextCode(state.accounts, card ? 2110 : 1020, codes)
          codes.push(code)
          ledger = (await command('account.save', { code, name: c.name, type: card ? 'liability' : 'asset', subtype: 'bank' })).id
        }
        accounts.push({ id: a.id, bankAccountId: 'new', new: { name: c.name, accountId: ledger, openingDate: c.openingDate, openingBalance: c.openingBalance } })
      }
      const r = await command('feed.map', { itemId: connection.id, accounts })
      await reload(); onDone(r)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <Card title={`2 · Choose where each ${connection.institution_name} account goes`}>
    <p className="hint">Each account feeds one Pantry bank or card account. Transactions after its opening date come in; leave out any you do not keep books for.</p>
    <div className="connect-accounts">{connection.accounts.map((a: D) => { const c = choices[a.id]; return <fieldset key={a.id} className="connect-account">
      <legend>{a.name} <small className="sub">••{a.mask} · {a.kind}{a.balance_cents !== null ? ` · ${usd(a.balance_cents)}` : ''}</small></legend>
      <Field label="Brings transactions into" name={`target-${a.id}`} value={c.target} onChange={(e: any) => set(a.id, { target: e.target.value })}
        empty="Leave it out" options={[...free.map((b: D) => ({ value: b.id, label: `${b.name} (…${b.number_last4})` })), { value: 'new', label: 'A new bank or card account' }]} />
      {c.target === 'new' && <div className="grid-form">
        <Field label="Name in Pantry" name={`name-${a.id}`} value={c.name} onChange={(e: any) => set(a.id, { name: e.target.value })} />
        <Field label="Ledger account" name={`ledger-${a.id}`} value={c.ledger} onChange={(e: any) => set(a.id, { ledger: e.target.value })} options={[{ value: CREATE, label: `Create “${c.name}” in the chart` }, ...ledgers]} />
        <Field label="Opening date" name={`date-${a.id}`} type="date" value={c.openingDate} onChange={(e: any) => set(a.id, { openingDate: e.target.value })} hint="Transactions after this day come in" />
        <Field label="Balance on that day" name={`balance-${a.id}`} inputMode="decimal" value={c.openingBalance} onChange={(e: any) => set(a.id, { openingBalance: e.target.value })} hint={a.kind.startsWith('credit') ? 'What you owed, as a negative amount' : 'From that day’s statement'} />
      </div>}
    </fieldset> })}</div>
    <div className="form-end"><button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Bringing transactions in…' : 'Bring transactions in'}</button>{error && <p role="alert" className="error">{error}</p>}</div>
  </Card>
}

export function Connect() {
  const feeds = useView<D>('bank/feeds')
  const [connection, setConnection] = useState<D | null>(null), [result, setResult] = useState<D | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const start = async (resume?: { token: string; purpose: string }) => {
    setBusy(true); setError('')
    try {
      if (resume?.purpose.startsWith('relink:')) {
        if (await openLink(resume.token, resume.purpose, true)) setResult(await command('feed.relinked', { itemId: resume.purpose.slice(7) }))
        return
      }
      const token = resume?.token ?? (await command('feed.link-token', {})).linkToken
      const linked = await openLink(token, 'connect', !!resume)
      if (linked) setConnection(await command('feed.connect', { publicToken: linked.publicToken, institution: linked.institution }))
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => {
    const resume = pendingLink()
    if (resume) void start(resume)
  }, [])
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('connection')
    const found = id && feeds.data?.connections.find((c: D) => c.id === id)
    if (found && !connection) setConnection(found)
  }, [feeds.data])
  if (!feeds.data) return <Loading error={feeds.error} what="bank feeds" />
  const a = feeds.data.availability
  return <>
    <PageHead title="Connect a bank or card" lead="Sign in to your bank once, through Plaid. Pantry never sees your bank password, and transactions arrive on their own from then on." actions={<Link to="/app/bank" className="btn btn-secondary">Back to Bank</Link>} />
    {!a.available ? <Card title="Not available on this installation"><p>{a.reason}</p><p><Link to="/app/bank" search={{ tab: 'statements' }}>Import a statement file</Link></p></Card> : <div className="connect stack">
      <Card title="1 · Sign in to your bank" actions={connection && <Chip tone="good">{connection.institution_name}</Chip>}>
        {connection ? <p className="hint">Connected to {connection.institution_name} with {connection.accounts.length} account{connection.accounts.length === 1 ? '' : 's'}.</p>
          : <><p className="hint">Plaid opens in a window over this page. Choose your bank or card issuer and sign in there.{a.environment === 'sandbox' ? ' This installation uses Plaid’s sandbox: sign in with user_good / pass_good.' : ''}</p>
            <div className="form-end"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()}>{busy ? 'Opening Plaid…' : 'Connect a bank or card'}</button>{error && <p role="alert" className="error">{error}</p>}</div></>}
      </Card>
      {connection && !result && <Choose connection={connection} onDone={setResult} />}
      {result && <Card title="3 · Transactions are coming in">
        {result.sync?.error ? <p className="error">{result.sync.message}</p> : <p><strong>{result.sync?.added ?? 0} transaction{result.sync?.added === 1 ? '' : 's'} came in</strong>{result.sync?.filed ? `, ${result.sync.filed} filed by your rules` : ''}{result.sync?.pending ? `, ${result.sync.pending} pending at the bank` : ''}. New ones arrive on their own; Pantry checks every few hours and as soon as the bank says there is news.</p>}
        <div className="form-end"><Link to="/app/bank" className="btn btn-primary">See transactions</Link></div>
      </Card>}
    </div>}
  </>
}
