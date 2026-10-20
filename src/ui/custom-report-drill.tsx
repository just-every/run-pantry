import { useState } from 'react'
import { Card, Chip, FileLink, Loading, Table, day, usd, useView, type D } from './kit'

export const reportFigureValue = (value: number | null, unit: string) => value === null ? 'undefined' : unit === 'money' ? usd(value) : unit === 'percent' ? `${value.toFixed(2)}%` : `${value.toFixed(2)} ratio`
const localPath = (href: string) => href.replace(/^\/api\/pantry\//, '')

export function CustomReportDrill({ path, onClose }: { path: string; onClose: () => void }) {
  const [steps, setSteps] = useState([path])
  const { data: d, error } = useView<D>(localPath(steps.at(-1)!))
  const back = <div className="row-actions"><button className="btn btn-secondary" type="button" onClick={onClose}>Close figure</button>{steps.length > 1 && <button className="btn btn-secondary" type="button" onClick={() => setSteps(s => s.slice(0, -1))}>Back to operand</button>}</div>
  if (!d) return <>{back}<Loading error={error} what="the records behind this figure" /></>
  return <Card title={<>Figure: {d.label} <Chip tone="info">{d.basis === 'cash' ? 'Cash basis' : 'Accrual basis'}</Chip></>} actions={back}>
    <p><strong>{reportFigureValue(d.value, d.unit)}</strong> · {d.from ? <>{day(d.from)} to {day(d.to)}</> : <>All activity through {day(d.to)}</>}</p>
    {d.expression && <p>Formula: <code>{d.expression}</code></p>}
    {d.operands.length > 0 && <Table heads={['Operand', 'Value', 'Basis and range']} figures={[1]}>
      {d.operands.map((o: D, i: number) => <tr key={`${o.href}-${i}`}><td><button className="btn btn-link" type="button" onClick={() => setSteps(s => [...s, o.href])}>Open operand {o.label}</button></td><td className="fig">{reportFigureValue(o.value, o.unit)}{o.exact && o.exact.denominator !== '1' && <small className="sub block">Exact intermediate: {o.exact.numerator}/{o.exact.denominator} {o.unit === 'money' ? 'cents' : o.unit}</small>}</td><td>{o.basis === 'cash' ? 'Cash basis' : 'Accrual basis'} · {o.from || 'Beginning'} to {o.to}</td></tr>)}
    </Table>}
    {d.rows && <>
      <p><Chip tone={d.ties ? 'good' : 'bad'}>{d.ties ? 'Adds up to the report figure' : 'Does not add up to the report figure'}</Chip></p>
      <Table heads={['Date', 'Record', 'Account and description', 'Documents', 'Bank', 'Amount']} figures={[5]} empty="No posted lines behind this figure.">
        {d.rows.map((r: D, i: number) => <tr key={`${r.key}-${i}`}><td>{day(r.date)}</td><td><a href={`/app/reports?${new URLSearchParams({ record: `${r.record.kind}:${r.record.id}` })}`}>{r.record.label}</a></td><td>{r.account.code} · {r.account.name}<small className="sub block">{r.description}</small>{r.settlement && <small className="sub block">Settled by <a href={`/app/reports?${new URLSearchParams({ record: `${r.settlement.by.kind}:${r.settlement.by.id}` })}`}>{r.settlement.by.label}</a> · {r.settlement.share}</small>}</td><td>{r.documents.map((doc: D) => <FileLink key={doc.id} id={doc.id} name={doc.name} />)}</td><td>{r.bank.map((b: D) => <p key={b.id}>{day(b.date)} · {b.description} · {usd(b.amount)}{b.statementDocumentId && <> · <a href={`/api/pantry/documents/${b.statementDocumentId}`}>Statement</a></>}</p>)}</td><td className="fig">{usd(r.amount)}</td></tr>)}
        <tr className="total"><td>Total</td><td /><td /><td /><td /><td className="fig">{usd(d.total)}</td></tr>
      </Table>
    </>}
  </Card>
}
