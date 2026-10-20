import { RecordHistory } from './record-history'
// A report figure opened to the lines behind it, and any record opened from
// there with its documents, journal entries, linked records and bank lines.
// Each level is an address, so every step links onward and back.
import { Link, useSearch } from '@tanstack/react-router'
import { Card, Chip, Loading, Table, day, usd, useView, type D } from './kit'
import { AskAccountant } from './ask-accountant'

export const BASIS_NAME: Record<'cash' | 'accrual', string> = { cash: 'Cash basis', accrual: 'Accrual basis' }

/** A link to a record, keeping the report and figure it was opened from. */
function RecordLink({ r }: { r: D }) {
  const search = useSearch({ from: '/app/reports' })
  return <Link to="/app/reports" search={{ ...search, record: `${r.kind}:${r.id}` }}>{r.label}</Link>
}

const Documents = ({ docs }: { docs: D[] }) => docs.length ? <>{docs.map(d => <a key={d.id} className="doc-link" href={`/api/pantry/documents/${d.id}`}>{d.name}</a>)}</> : <span className="sub">—</span>
const Bank = ({ lines }: { lines: D[] }) => lines.length ? <>{lines.map(b => <span key={b.id} className="bank-line">{day(b.date)} · {b.description} · {usd(b.amount)} · {b.reconciled ? 'reconciled' : 'matched'}{b.statementDocumentId && <> · <a href={`/api/pantry/documents/${b.statementDocumentId}`}>statement</a></>}</span>)}</> : <span className="sub">Not matched</span>

export function FigureDetail({ report, line, from, to, basis, reportLabel }: { report: string; line: string; from: string; to: string; basis: 'cash' | 'accrual'; reportLabel: string }) {
  const search = useSearch({ from: '/app/reports' })
  const { data: d, error } = useView<D>(`reports/detail?${new URLSearchParams({ report, line, from, to, basis, ...(search.account ? { account: search.account } : {}) })}`)
  const exportQuery = new URLSearchParams(Object.entries({ ...search, report, line, from, to, basis }).filter(([, value]) => value !== undefined) as [string, string][]).toString()
  const back = <Link to="/app/reports" search={{ ...search, line: undefined, record: undefined }}>{reportLabel}</Link>
  if (!d) return <><nav className="crumbs" aria-label="Report">{back}</nav><Loading error={error} what="the records behind this figure" /></>
  const accounts = new Set(d.rows.map((r: D) => r.account.id)).size > 1
  return <>
    <nav className="crumbs" aria-label="Report">{back} <span aria-hidden="true">›</span> <span>{d.label}</span></nav>
    <Card title={<>{d.label} <Chip tone="info">{BASIS_NAME[basis]}</Chip></>} actions={<strong className="figure-total">{usd(d.figure)}</strong>}>
      <p>{d.scopeNote ? d.scopeNote : d.from ? <>{day(d.from)} to {day(d.to)}</> : <>All posted activity through {day(d.to)}</>} · {d.rows.length} line{d.rows.length === 1 ? '' : 's'} · {d.ties ? <Chip tone="good">Adds up to the report figure</Chip> : <Chip tone="bad">Does not add up to the report figure</Chip>}</p>
      {basis === 'cash' && <p className="hint">On the cash basis an invoice, credit or bill counts as it is paid or credited: each line below is the share of a document its settlement covered, spread across the document's lines.</p>}
      <p><a href={`/api/pantry/reports/detail/export?${exportQuery}`}>Export source lines CSV</a></p>
      <AskAccountant key={JSON.stringify({ report, line, from, to, basis })} subjectKind="report-line" subjectId={JSON.stringify({ report, line, from, to, basis })} label={`${reportLabel} · ${d.label} · ${from || 'Beginning'} to ${to} · ${BASIS_NAME[basis]} · ${usd(d.figure)}`} />
      <Table heads={['Date', 'Record', 'What', ...(accounts ? ['Account'] : []), 'Documents', 'Bank', 'Amount']} figures={[accounts ? 6 : 5]} empty="No posted lines behind this figure.">
        {[...d.rows.map((r: D) => <tr key={r.key}>
          <td>{day(r.date)}</td>
          <td><RecordLink r={r.record} />{r.entry?.number ? <small className="sub"> · entry {r.entry.number}</small> : null}<AskAccountant subjectKind={r.record.kind === 'entry' ? 'journal' : r.record.kind} subjectId={r.record.id} label={`${r.record.label} · ${r.date} · ${r.description}`} /></td>
          <td>{r.description}{r.lineMemo && r.lineMemo !== r.description ? <small className="sub"> · {r.lineMemo}</small> : null}{r.settlement && <small className="sub"> · settled by <RecordLink r={r.settlement.by} /> ({r.settlement.share})</small>}</td>
          {accounts && <td>{r.account.code} · {r.account.name}</td>}
          <td><Documents docs={r.documents} /></td>
          <td><Bank lines={r.bank} /></td>
          <td className="fig">{usd(r.amount)}</td></tr>),
          <tr key="total" className="total"><td>Total</td><td /><td />{accounts && <td />}<td /><td /><td className="fig">{usd(d.total)}</td></tr>]}
      </Table>
    </Card>
  </>
}

const STATUS: Record<string, string> = { issued: 'Issued', posted: 'Recorded', draft: 'Draft', approved: 'Approved', void: 'Void', recorded: 'Recorded', reversed: 'Reversed' }
const METHOD: Record<string, string> = { unrecorded: 'Not recorded', check: 'Check', ach: 'ACH', wire: 'Wire', cash: 'Cash', card: 'Card', 'payment-network': 'Payment network' }

export function RecordView({ record, reportLabel }: { record: string; reportLabel: string }) {
  const search = useSearch({ from: '/app/reports' })
  const [kind, id] = record.split(':')
  const { data: r, error } = useView<D>(`reports/record/${kind}/${id}`)
  const crumbs = <nav className="crumbs" aria-label="Report"><Link to="/app/reports" search={{ ...search, line: undefined, record: undefined, customId: undefined, row: undefined, column: undefined, node: undefined, origin: undefined }}>{reportLabel}</Link>{(search.line || search.customId && search.row) && <> <span aria-hidden="true">›</span> <Link to="/app/reports" search={{ ...search, record: undefined }}>Back to the figure</Link></>}{r && <> <span aria-hidden="true">›</span> <span>{r.title}</span></>}</nav>
  if (!r) return <>{crumbs}<Loading error={error} what="the record" /></>
  return <>
    {crumbs}
    <p><a href={`/api/pantry/reports/record/${kind}/${id}/export?${new URLSearchParams(Object.entries(search).filter(([, value]) => value !== undefined) as [string, string][]).toString()}`}>Export record JSON</a></p>
    <div className="split split-wide-left">
      <div className="stack">
        <Card title={r.title} actions={<Chip tone={r.status === 'reversed' || r.status === 'void' ? 'warn' : 'good'}>{STATUS[r.status] ?? r.status}</Chip>}>
          <dl className="facts">
            <div><dt>Date</dt><dd>{day(r.date)}</dd></div>
            <div><dt>Amount</dt><dd>{usd(r.total)}</dd></div>
            {r.open !== undefined && <div><dt>Open</dt><dd>{usd(r.open)}</dd></div>}
            {r.method && <div><dt>Paid by</dt><dd>{METHOD[r.method] ?? r.method}{r.reference ? ` · ${r.reference}` : ''}{r.bankName ? ` · ${r.bankName}` : ''}</dd></div>}
            {r.evidenceWaived && <div><dt>No document</dt><dd>{r.evidenceWaived}</dd></div>}
          </dl>
          <AskAccountant key={record} subjectKind={kind === 'entry' ? 'journal' : kind} subjectId={id} label={`${r.title} · ${r.date} · ${usd(r.total)}`} />
          {r.lines.length > 0 && <Table heads={['Line', 'Amount', ...(kind === 'invoice' ? ['Tax', 'Tax code'] : [])]} figures={[1, 2]}>
            {r.lines.map((l: D, i: number) => <tr key={i}><td>{l.description}</td><td className="fig">{usd(l.amount)}</td>{kind === 'invoice' && <><td className="fig">{usd(l.tax)}</td><td>{l.taxCode}</td></>}</tr>)}
          </Table>}
        </Card>
        {r.entries.map((e: D) => <Card key={e.id} title={`Journal entry ${e.number ?? '(draft)'}`}>
          <p>{day(e.date)} · {e.memo}</p>
          <AskAccountant subjectKind="journal" subjectId={e.id} label={`Journal entry ${e.number ?? '(draft)'} · ${e.date} · ${e.memo}`} />
          <Table heads={['Account', 'Memo', 'Debit', 'Credit']} figures={[2, 3]}>
            {e.lines.map((l: D, i: number) => <tr key={i}><td>{l.account}</td><td>{l.memo}</td><td className="fig">{l.debit ? usd(l.debit) : ''}</td><td className="fig">{l.credit ? usd(l.credit) : ''}</td></tr>)}
          </Table>
        </Card>)}
      </div>
      <div className="stack">
        <Card title="Linked records">{r.links.length ? <ul className="plain">{r.links.map((l: D) => <li key={`${l.kind}:${l.id}`}><RecordLink r={l} />{l.note && <small className="sub"> · {l.note}</small>}</li>)}</ul> : <p>Nothing else is linked to this record.</p>}</Card>
        <Card title="Documents">{r.documents.length ? <ul className="plain">{r.documents.map((d: D) => <li key={d.id}><a href={`/api/pantry/documents/${d.id}`}>{d.name}</a></li>)}</ul> : <p>No document is attached.</p>}</Card>
        <RecordHistory record={r} />
        <Card title="Bank statement lines">{r.bank.length ? <ul className="plain">{r.bank.map((b: D) => <li key={b.id}>{day(b.date)} · {b.description} · {usd(b.amount)} · {b.bank} · {b.reconciled ? 'reconciled' : 'matched, not yet reconciled'}{b.statementDocumentId && <> · <a href={`/api/pantry/documents/${b.statementDocumentId}`}>statement file</a></>}</li>)}</ul> : <p>Not matched to a statement line yet.</p>}</Card>
      </div>
    </div>
  </>
}
