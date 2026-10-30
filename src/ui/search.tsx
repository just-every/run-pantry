import { useRouterState } from '@tanstack/react-router'
import { Card, Chip, Field, PageHead, Table, day, usd, useView, Loading, useShared } from './kit'

const TYPES = ['invoice','credit','estimate','bill','vendor-credit','payment','check','journal','bank-line','pending','document']
export function Search() {
  const search = useRouterState({select:s=>s.location.searchStr}), query = new URLSearchParams(search)
  const { data,error } = useView<any>('search?'+query), {state}=useShared()
  return <><PageHead title={query.has('record')?'Transaction record':'Find a transaction'} lead="Search the records available to your role. Amounts match money in or out." />
    <Card title="Search your books"><form action="/app/search" className="form">
      <Field label="Amount, reference or words" name="q" defaultValue={query.get('q')??''} placeholder="1234.56, check 1047, vendor or memo" />
      <details open={['min','max','from','to','type','account','status'].some(k=>query.has(k))}><summary>Advanced filters</summary><div className="form-grid">
        <Field label="Minimum amount" name="min" defaultValue={query.get('min')} inputMode="decimal" />
        <Field label="Maximum amount" name="max" defaultValue={query.get('max')} inputMode="decimal" />
        <Field label="From date" name="from" type="date" defaultValue={query.get('from')} />
        <Field label="To date" name="to" type="date" defaultValue={query.get('to')} />
        <Field label="Record type" name="type" defaultValue={query.get('type')} options={TYPES.map(t=>({value:t,label:t.replaceAll('-',' ')}))} empty="All available types" />
        <Field label="Account" name="account" defaultValue={query.get('account')} options={state.accounts.map((a:any)=>({value:a.id,label:`${a.code} · ${a.name}`}))} empty="All available accounts" />
        <Field label="Status" name="status" defaultValue={query.get('status')} options={['draft','approved','issued','posted','recorded','reversed','matched','unposted','pending','excluded','linked','unlinked'].map(t=>({value:t,label:t}))} empty="All statuses" />
      </div></details><div className="form-end"><button className="btn btn-primary">Search records</button><a href="/app/search">Clear filters</a></div>
    </form></Card>
    {!data ? <Loading error={error} what="search results" /> : <div aria-live="polite">
      {data.groups.length===0&&<Card title="No matching records"><p>No records available to your role match these filters.</p></Card>}
      {data.groups.map((g:any)=><Card key={g.type} title={g.type === 'bank-line' ? 'Bank transactions' : g.type.replaceAll('-',' ')}><Table heads={['Date','Number or file','Contact','Description','Amount','Status']} figures={[4]}>
        {g.records.map((r:any)=><tr key={r.id}><td>{day(r.date)}</td><td>{query.has('record')?<strong>{r.number || (g.type === 'bank-line' ? 'View transaction' : g.type.replaceAll('-', ' '))}</strong>:<a href={r.href}>{r.number || (g.type === 'bank-line' ? 'View transaction' : g.type.replaceAll('-', ' '))}</a>}</td><td>{r.contact||'—'}</td><td>{r.description||'—'}</td><td>{usd(r.amount)}</td><td><Chip>{g.type === 'bank-line' && r.status === 'matched' ? 'In the books' : r.status}</Chip></td></tr>)}
      </Table></Card>)}
      {query.has('record')&&<p><a href="/app/search">Back to search</a></p>}
      {data.nextCursor&&<p><a href={'/app/search?'+new URLSearchParams({...Object.fromEntries(query),cursor:data.nextCursor})}>Next results</a></p>}
    </div>}
  </>
}
