import { Action, Card, command, Field, Form, Table, useShared, type D } from './kit'
const KINDS = [['class','Class','classes_enabled'],['location','Location','locations_enabled'],['project','Project','projects_enabled']] as const

// Use the existing forms, fields and responsive tables; no new visual system.
export function DimensionFields({line,index,onChange}:{line:D;index:number;onChange:(patch:D)=>void}) {
 const {state}=useShared(),d=state.dimensions
 if(!d)return null
 return <>{KINDS.filter(([, ,flag])=>d.settings[flag]).map(([kind,label])=><Field key={kind} label={`Line ${index+1} ${kind}`} name={`line-${index}-${kind}`} value={line[`${kind}Name`]??''} onChange={(e:any)=>onChange({[`${kind}Name`]:e.target.value})} options={[{value:'',label:`No ${kind}`},...d.values.filter((v:D)=>v.kind===kind&&(v.active||v.name===line[`${kind}Name`])).map((v:D)=>({value:v.name,label:v.name+(v.active?'':' (inactive)')}))]} />)}</>
}
export function DimensionSettings() {
 const {state,reload}=useShared(),d=state.dimensions
 if(!d||!state.actor.can.owner)return null
 return <Card title="Classes, locations and projects">
  <p className="hint">Turn on the dimensions used by this business. Names are retained on posted records. Deactivation stops new coding; it keeps earlier evidence.</p>
  <Form key={d.settings.revision} label="Save dimension settings" submit={b=>command('dimensions.settings',{revision:d.settings.revision,...Object.fromEntries(KINDS.map(([kind])=>[kind,b[kind]==='on']))})} onDone={reload}>
   {KINDS.map(([kind,label,flag])=><label className="check" key={kind}><input type="checkbox" name={kind} defaultChecked={!!d.settings[flag]} /> Enable {kind==='class'?'classes':kind==='location'?'locations':'projects'}</label>)}
  </Form>
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
