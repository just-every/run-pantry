import { useNavigate, useSearch } from '@tanstack/react-router'
import { Action, Card, command, Field, Form, Table, useShared, type D } from './kit'
import { Help } from './help'
const KINDS = [['class','Class','classes_enabled'],['location','Location','locations_enabled'],['project','Project','projects_enabled']] as const

// Use the existing forms, fields and responsive tables; no new visual system.
export function DimensionFields({line,index,onChange,label='Line'}:{line:D;index:number;label?:string;onChange:(patch:D)=>void}) {
 const {state}=useShared(),d=state.dimensions
 if(!d)return null
 return <>{KINDS.filter(([, ,flag])=>d.settings[flag]).map(([kind])=><Field key={kind} label={`${label}${label==='Line'?' '+(index+1):''} ${kind}`} name={`${label.toLowerCase().replaceAll(' ','-')}-${index}-${kind}`} value={line[`${kind}Name`]??''} onChange={(e:any)=>onChange({[`${kind}Name`]:e.target.value})} options={[{value:'',label:`No ${kind}`},...d.values.filter((v:D)=>v.kind===kind&&(v.active||v.name===line[`${kind}Name`])).map((v:D)=>({value:v.name,label:v.name+(v.active?'':' (inactive)')}))]} />)}</>
}
export function DimensionSettings() {
 const {state,reload}=useShared(),d=state.dimensions
 if(!d||!state.actor.can.owner)return null
 return <Card title="Classes, locations and projects">
  <Form key={d.settings.revision} label="Save dimension settings" submit={b=>command('dimensions.settings',{revision:d.settings.revision,...Object.fromEntries(KINDS.map(([kind])=>[kind,b[kind]==='on']))})} onDone={reload}>
   {KINDS.map(([kind,label,flag])=><label className="check" key={kind}><input type="checkbox" name={kind} defaultChecked={!!d.settings[flag]} /> Enable {kind==='class'?'classes':kind==='location'?'locations':'projects'}</label>)}
  </Form>
  <Help label="How dimensions work"><p>Turn on the dimensions used by this business. Names are retained on posted records. Deactivation stops new coding; it keeps earlier evidence.</p></Help>
  <Table heads={['Dimension','Name','Status','']} empty="No dimension values yet.">
   {d.values.map((v:D)=><tr key={v.id}><td>{v.kind}</td><td>{v.name}</td><td>{v.active?'Active':'Inactive'}</td><td><Action run={async()=>{await command('dimension.save',{...v,active:!v.active});await reload()}}>{v.active?'Deactivate':'Reactivate'} {v.name}</Action></td></tr>)}
  </Table>
  <Form label="Add dimension value" submit={b=>command('dimension.save',b)} onDone={reload} className="grid-form">
   <Field label="Dimension kind" name="kind" required options={KINDS.map(([kind,label])=>({value:kind,label}))} />
   <Field label="Dimension name" name="name" required maxLength={100} />
  </Form>
  <details><summary>Payroll line coding</summary>
   <p className="hint">Selected coding applies to future payroll postings. Existing payroll entries keep their reviewed evidence.</p>
   <Table heads={['Payroll line','Class','Location','Project']} empty="Payroll coding is not set.">{d.payroll.map((p:D)=><tr key={p.role}><td>{p.role}</td><td>{p.class_name||'Unassigned'}</td><td>{p.location_name||'Unassigned'}</td><td>{p.project_name||'Unassigned'}</td></tr>)}</Table>
   <Form label="Save payroll coding" submit={b=>command('dimension.payroll',b)} onDone={reload} className="grid-form">
    <Field label="Payroll line role" name="role" required options={['wages','taxes','benefits','reimbursements','bank','liabilities'].map(value=>({value,label:value}))} />
    {KINDS.filter(([, ,flag])=>d.settings[flag]).map(([kind,label])=><Field key={kind} label={`Payroll ${kind}`} name={`${kind}Name`} empty="Unassigned" options={d.values.filter((v:D)=>v.kind===kind&&v.active).map((v:D)=>({value:v.name,label:v.name}))} />)}
   </Form>
  </details>
  <details><summary>Processor line coding</summary>
   <p className="hint">Selected coding applies to future Stripe sales, refunds, fees, clearing, bank and invoice receivable lines. Posted entries retain their original coding. Missing required values hold an item for review.</p>
   <Table heads={['Processor line','Class','Location','Project']} empty="Processor coding is not set.">{d.processor.map((p:D)=><tr key={p.role}><td>{p.role}</td><td>{p.class_name||'Unassigned'}</td><td>{p.location_name||'Unassigned'}</td><td>{p.project_name||'Unassigned'}</td></tr>)}</Table>
   <Form label="Save processor coding" submit={b=>command('dimension.processor',{...b,revision:d.processor.find((p:D)=>p.role===b.role)?.revision??''})} onDone={reload} className="grid-form">
    <Field label="Processor line role" name="role" required options={['sales','refunds','fees','clearing','bank','receivable'].map(value=>({value,label:value}))} />
    <DimensionFormFields label="Processor" />
   </Form>
  </details>
  <details><summary>Required dimensions by account</summary><p className="hint">Required values apply to new lines and postings while that dimension is enabled. Old posted records stay unchanged.</p>
   {state.accounts.filter((a:D)=>a.active).map((a:D)=><Form key={a.id+JSON.stringify(d.required)} label={`Save requirements for ${a.code}`} submit={b=>command('dimension.require',{accountId:a.id,kinds:KINDS.filter(([kind])=>b[kind]==='on').map(([kind])=>kind)})} onDone={reload}>
    <strong>{a.code} · {a.name}</strong>{KINDS.map(([kind,label])=><label className="check" key={kind}><input type="checkbox" name={kind} defaultChecked={d.required.some((r:D)=>r.account_id===a.id&&r.kind===kind)} /> Require {kind}</label>)}
   </Form>)}
  </details>
 </Card>
}

export function DimensionFormFields({label,defaults={}}:{label:string;defaults?:D}) {
 const {state}=useShared(),d=state.dimensions
 if(!d)return null
 return <>{KINDS.filter(([, ,flag])=>d.settings[flag]).map(([kind])=><Field key={kind} label={`${label} ${kind}`} name={`${kind}Name`} defaultValue={defaults[`${kind}Name`]??defaults[`${kind}_name`]??''} empty="Unassigned" options={d.values.filter((v:D)=>v.kind===kind&&(v.active||v.name===(defaults[`${kind}Name`]??defaults[`${kind}_name`]))).map((v:D)=>({value:v.name,label:v.name+(v.active?'':' (inactive)')}))} />)}</>
}

export function DimensionSelection({label='Dimension filter',value,onChange}:{label?:string;value:string;onChange:(value:string)=>void}){
 const {state}=useShared(),d=state.dimensions
 if(!d)return null
 const enabled=KINDS.filter(([, ,flag])=>d.settings[flag])
 const values=[...d.values,...(state.dimensionHistory??[]).filter((v:D)=>!d.values.some((c:D)=>c.kind===v.kind&&c.name===v.name)).map((v:D)=>({...v,historical:true}))]
 if(!enabled.length)return null
 return <Field label={label} name="dimensionFilter" value={value} empty="All dimensions" options={enabled.flatMap(([kind])=>[{value:JSON.stringify([kind,'unassigned']),label:`${kind} · Unassigned`},...values.filter((v:D)=>v.kind===kind).map((v:D)=>({value:JSON.stringify([kind,'value:'+v.name]),label:`${kind} · ${v.name}${v.historical?' (historical)':v.active?'':' (inactive)'}`}))])} onChange={(e:React.ChangeEvent<HTMLSelectElement>)=>onChange(e.target.value)} />
}
export function DimensionReportPicker(){
 const search=useSearch({from:'/app/reports'}),navigate=useNavigate({from:'/app/reports'})
 return <DimensionSelection value={search.dimension?JSON.stringify([search.dimension,search.dimensionValue]):''} onChange={value=>{const [dimension,dimensionValue]=value?JSON.parse(value):[];void navigate({search:s=>({...s,dimension,dimensionValue,split:undefined,line:undefined,record:undefined})})}} />
}
