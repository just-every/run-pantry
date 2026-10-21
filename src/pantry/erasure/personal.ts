// The declared personal fields; accounting names and posted free text are retained.
import type { Data } from '../core'
export const CONTACT_PERSONAL = ['email', 'phone', 'address', 'billing_address', 'service_address', 'internal_notes', 'bank_reference', 'external_ref'] as const
export const MARKER = '[erased]'
const BOOKKEEPING = /^(id|.*_id|revision|.*_revision|.*_cents|amount|total|subtotal|tax|number|code|.*_date|.*_at|tax_code|currency)$/
export function personalValues(row: Data, member = false): string[] {
  const values: string[] = []
  const collect = (value: unknown) => {
    if (typeof value === 'string' && value.trim() && value !== MARKER) values.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.entries(value).filter(([key]) => ['name','email','phone','address'].includes(key)).forEach(([,v]) => collect(v))
  }
  for (const key of member ? ['email','name'] : CONTACT_PERSONAL) collect(row[key])
  if (!member) collect(JSON.parse(row.contacts_json ?? '[]'))
  return [...new Set(values)].sort((a,b) => b.length-a.length)
}
export function scrub(value: unknown, values: string[], marker = MARKER): unknown {
  if (typeof value === 'string') return values.reduce((s, personal) => s.replaceAll(personal, marker), value)
  if (Array.isArray(value)) return value.map(v => scrub(v,values,marker))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,BOOKKEEPING.test(k)?v:scrub(v,values,marker)]))
  return value
}

/** Values in earlier declared personal-field revisions are erased as well. */
export async function erasureValues(db: D1Database, subject: Data, member=false): Promise<string[]> {
  const {all}=await import('../db')
  const values=new Set(personalValues(subject,member)), ids=new Set([member?subject.email:subject.id])
  const rows=await all(db,"SELECT subject_id,detail FROM pt_audit WHERE subject_kind IN ('customer','vendor','member') ORDER BY at")
  for(let changed=true;changed;) {
    changed=false
    for(const row of rows) {
      const detail=JSON.parse(row.detail)
      if(!ids.has(row.subject_id) && !(member&&[detail.previousEmail,detail.before?.email,detail.after?.email].some(v=>ids.has(v))))continue
      for(const snapshot of [detail.before,detail.after])if(snapshot&&typeof snapshot==='object')for(const value of personalValues(snapshot,member))values.add(value)
      if(member)for(const id of [row.subject_id,detail.previousEmail,detail.before?.email,detail.after?.email].filter(Boolean))if(!ids.has(id)){ids.add(id);values.add(id);changed=true}
    }
  }
  return [...values].filter(v=>v!==MARKER).sort((a,b)=>b.length-a.length)
}
