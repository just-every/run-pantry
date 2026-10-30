import { Help } from './help'
import { useRef, useState } from 'react'
import { Card, command, Field, Form, readFileBase64, type D } from './kit'

export function InvoiceTemplateEditor({ template, onSaved, onCancel }: { template?: D; onSaved: (t: D) => Promise<void>; onCancel: () => void }) {
  const logo = useRef<HTMLInputElement>(null), [removeLogo, setRemoveLogo] = useState(false)
  const [fields, setFields] = useState<D[]>(template?.fields ?? [])
  const patch = (i: number, b: D) => setFields(fs => fs.map((f, n) => n === i ? { ...f, ...b } : f))
  return <Card title={template ? `Edit template · ${template.name}` : 'New invoice template'}>
    <Form label="Save invoice template" submit={async b => {
      const image = logo.current?.files?.length ? await readFileBase64(logo.current) : null
      return command('invoice-template.save', { ...b, id: template?.id, revision: template?.revision, fields, ...(image ? { logoBase64: image.base64 } : removeLogo ? { logoBase64: null } : {}) })
    }} onDone={onSaved} secondary={<button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel template edit</button>}>
      <div className="grid-form">
        <Field label="Template name" name="name" defaultValue={template?.name} required />
        <Field label="Document layout" name="layout" defaultValue={template?.layout ?? 'classic'} options={[{ value: 'classic', label: 'Classic · compact heading' }, { value: 'banner', label: 'Banner · color across the heading' }]} required />
        <Field label="Accent color" name="accentColor" type="color" defaultValue={template?.accentColor ?? '#433b65'} required />
        <Field label="Text color" name="textColor" type="color" defaultValue={template?.textColor ?? '#202234'} required />
        <Field label="Default invoice terms (days)" name="termsDays" type="number" min={0} max={365} defaultValue={template?.termsDays ?? 30} required hint="Used unless the customer has its own payment terms. Zero means due on receipt." />
      </div>
      <div className="field"><label htmlFor="invoice-logo">Logo · JPEG, up to 100 KB</label><input id="invoice-logo" ref={logo} type="file" accept="image/jpeg,.jpg,.jpeg" /><Help label="Logo requirements"><p>RGB or grayscale, up to 4000 × 4000 pixels. The image is kept inside each issued PDF.</p></Help></div>
      {template?.logo && <><img src={`data:image/jpeg;base64,${template.logo.base64}`} alt={`${template.name} logo`} width="100" /><label className="check"><input type="checkbox" checked={removeLogo} onChange={e => setRemoveLogo(e.target.checked)} />Remove saved logo</label></>}
      <div className="grid-form">
        <Field label="Business address on invoices" name="address" type="textarea" defaultValue={template?.address} />
        <Field label="Remit to" name="remitTo" type="textarea" defaultValue={template?.remitTo} />
        <Field label="Payment instructions" name="paymentInstructions" type="textarea" defaultValue={template?.paymentInstructions} />
        <Field label="Template message" name="message" type="textarea" defaultValue={template?.message} />
        <Field label="Invoice footer" name="footer" type="textarea" defaultValue={template?.footer} />
      </div>
      <fieldset className="allocations"><legend>Custom invoice fields</legend>
        {fields.map((f, i) => <div className="grid-form" key={i}>
          <Field label={`Field ${i + 1} key`} name={`field-${i}-key`} value={f.key} onChange={(e: any) => patch(i, { key: e.target.value })} required hint="For example po_number. Lowercase letters, numbers and underscores." />
          <Field label={`Field ${i + 1} label`} name={`field-${i}-label`} value={f.label} onChange={(e: any) => patch(i, { label: e.target.value })} required />
          <Field label={`Field ${i + 1} default value`} name={`field-${i}-default`} value={f.defaultValue} onChange={(e: any) => patch(i, { defaultValue: e.target.value })} />
          <button type="button" className="btn btn-link" onClick={() => setFields(fs => fs.filter((_, n) => n !== i))}>Remove field {i + 1}</button>
        </div>)}
        {fields.length < 12 && <button type="button" className="btn btn-secondary" onClick={() => setFields(fs => [...fs, { key: '', label: '', defaultValue: '' }])}>Add custom field</button>}
      </fieldset>
    </Form>
  </Card>
}
