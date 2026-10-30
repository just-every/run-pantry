// Connected banks and cards: each connection's accounts with their last sync,
// a plain warning and a Re-link button when the bank needs the owner to sign in
// again, and the link to connect another one.
import { Link } from '@tanstack/react-router'
import { Action, Card, Chip, command, usd, useShared, type D } from './kit'
import { Icon } from './icons'
import { openLink } from './plaid-link'
import { SetupSteps } from './provider-guides'
import { HistoryChoice, HistoryObservations } from './feed-history'

export function ago(iso?: string | null) {
  if (!iso) return 'never'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export async function relink(c: D) {
  const { linkToken } = await command('feed.link-token', { itemId: c.id })
  if (!await openLink(linkToken, `relink:${c.id}`)) return false
  await command('feed.relinked', { itemId: c.id })
  return true
}

function Connection({ c, notice, onDone }: { c: D; notice?: D; onDone: () => Promise<void> }) {
  const can = useShared().state.actor.can.record
  const brought = c.accounts.filter((a: D) => a.bank_account_id)
  return <div className="feed">
    <div className="feed-head"><strong>{c.institution_name}</strong>{notice ? <Chip tone="warn">{notice.kind === 'expiring' ? 'Consent expiring' : notice.requiresRelink ? 'Needs re-link' : 'Needs attention'}</Chip> : <Chip tone="good">Live</Chip>}</div>
    <ul className="feed-accounts">{c.accounts.map((a: D) => <li key={a.id}>
      <span>{a.name} <small className="sub">••{a.mask}</small></span>
      {a.bank_account_id ? <small>→ {a.bank_name} · {a.last_synced_at ? <>synced {ago(a.last_synced_at)}</> : 'not synced yet'}{a.pending ? ` · ${a.pending} pending` : ''}{a.balance_cents !== null ? ` · bank shows ${usd(a.balance_cents)}${a.kind.startsWith('credit') ? ' owed' : ''} · ${a.balance_as_of ? `as of ${a.balance_as_of}` : `observed ${a.balance_observed_at ?? a.last_synced_at ?? 'at an unknown time'} (bank gave no as-of time)`}` : ''}</small> : <small className="sub">Not brought in</small>}
      {a.bank_account_id && can && <HistoryChoice account={a} onDone={onDone} />}
    </li>)}</ul>
    {c.status === 'active' && brought.length > 0 && <p className="hint">Next sync: {new Date(c.sync_due_at).getTime() <= Date.now() ? 'due now' : new Date(c.sync_due_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>}
    {c.status === 'relink' && <p className="hint">Next sync: after you re-link.</p>}
    {c.status === 'active' && c.last_sync_error && <p className="hint">Last try: {c.last_sync_error}. Pantry tries again within the hour.</p>}
    {can && <div className="row-actions small">
      {/* The notice at the top of Bank carries the navy Re-link; here it is the quiet second door. */}
      {c.status === 'relink' && <Action run={async () => { await relink(c); await onDone() }}>Re-link</Action>}
      {!brought.length && <Link className="btn btn-primary btn-small" to="/app/bank/connect" search={{ connection: c.id }}>Choose accounts</Link>}
      {c.status === 'active' && brought.length > 0 && <Action run={async () => { await command('feed.sync', { itemId: c.id }); await onDone() }}>Sync now</Action>}
      <Action tone="danger" run={async () => { if (window.confirm(`Disconnect ${c.institution_name}? Lines already in Pantry stay.`)) { await command('feed.disconnect', { itemId: c.id }); await onDone() } }}>Disconnect</Action>
    </div>}
  </div>
}

/** Shared by Bank and the dashboard: show every current gap or consent warning. */
export function FeedHealthNotices({ notices, onDone }: { notices: D[]; onDone: () => Promise<void> }) {
  const can = useShared().state.actor.can.record
  return <>{notices.map(n => <div key={n.itemId} className="callout callout-warn relink" role="status"><Icon name="alert" />
    <div><strong>{n.message}</strong><span>{n.name}. Last successful sync: {n.lastSyncedAt ? new Date(n.lastSyncedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}.</span>
      {n.notification?.detail && n.notification.status !== 'local' && <small>{n.notification.detail}</small>}</div>
    {can && <Action tone="primary" run={async () => { if (n.requiresRelink) await relink({ id: n.itemId }); else await command('feed.sync', { itemId: n.itemId }); await onDone() }}>{n.requiresRelink ? 'Re-link' : 'Sync now'}</Action>}</div>)}</>
}

export function RelinkNotices({ data, onDone }: { data: D | undefined; onDone: () => Promise<void> }) {
  return <FeedHealthNotices notices={data?.health ?? []} onDone={onDone} />
}

export function Feeds({ data, onDone, onImport }: { data: D | undefined; onDone: () => Promise<void>; onImport: () => void }) {
  const { can } = useShared().state.actor
  if (!data) return null
  const a = data.availability, none = !data.connections.length
  // With nothing connected yet, connecting is the card's one action, so it leads the body instead of the head.
  // Without live feeds set up, importing a statement is the one action that works; the owner's setup steps wait behind their disclosure.
  // Once a connection exists the card is about connections: the setup guide belongs to the empty card only.
  const connect = (primary: boolean) => a.available && can.record && <Link className={`btn ${primary ? 'btn-primary' : 'btn-secondary btn-small'}`} to="/app/bank/connect">Connect a bank or card</Link>
  return <Card title="Bank and card feeds" actions={!none && connect(false)}>
    {none && <p>Connect a bank or card once and its transactions arrive on their own. Statement files keep working beside it.</p>}
    {data.connections.map((c: D) => <Connection key={c.id} c={c} notice={data.health?.find((n: D) => n.itemId === c.id)} onDone={onDone} />)}
    {data.exceptions?.map((e: D) => <div key={e.id} className="callout callout-warn" role="status"><Icon name="alert" /><div>
      <strong>{e.name}</strong>
      <p>{e.bank_name} · {e.preservedLine.date} · {e.preservedLine.description} · {usd(e.preservedLine.amountCents)}</p>
      <p>{e.kind === 'removed' ? 'The bank removed this transaction.' : `The bank now reports ${e.providerChange.date} · ${e.providerChange.description} · ${usd(e.providerChange.amountCents)}.`} The saved line, matches and ledger postings are preserved. Review the discrepancy before making a correction.</p>
      {e.protection === 'reconciled' && <p>The completed reconciliation is preserved.</p>}
    </div></div>)}
    <HistoryObservations history={data.history} canRecord={can.record} onDone={onDone} />
    {none && !a.available && (a.needsKeys ? <SetupSteps provider="plaid" reason={a.reason} summary="Set up live bank feeds" owner={can.owner} /> : <p className="hint">{a.reason}</p>)}
    {none && (a.available ? connect(true) : can.record && <button type="button" className="btn btn-primary" onClick={onImport}>Import a statement</button>)}
  </Card>
}
