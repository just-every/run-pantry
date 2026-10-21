import {Table,type D} from './kit'
const words=(value:string)=>value.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase()
export function ErasureReceipt({receipt}:{receipt:D}) {
  return <section role="status"><h3>Erasure receipt · {receipt.id}</h3>
    <p>Erasure completed. Keep your latest archive as the journal when restoring older backups.</p>
    <Table heads={['Record class','Changes']} empty="No changes.">{Object.entries(receipt.counts??{}).map(([table,count])=><tr key={table}><td>{table}</td><td>{Object.entries(count as D).map(([key,n])=>`${words(key)}: ${n}`).join(' · ')}</td></tr>)}</Table>
    {!!receipt.retained?.length&&<><h4>Retained supporting items</h4><Table heads={['Record','Retained until']} empty="No retained items.">{receipt.retained.map((r:D,i:number)=><tr key={i}><td>{r.table}<small className="sub">{r.id}</small></td><td>{r.expires}</td></tr>)}</Table></>}
    <p className="hint">Outside this erasure: {(receipt.limitations??receipt.exclusions??[]).join('; ')}.</p>
    <details><summary>Receipt JSON</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(receipt,null,2)}</pre></details>
  </section>
}
