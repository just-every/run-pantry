import { requireThat, type Data } from '../core'
import { one } from '../db'
import { DIMENSIONS, type DimensionKind } from './index'
export type DimensionScope={kind:DimensionKind;value:string;id:string;label:string}
export async function dimensionScope(db:D1Database,kind?:string,id?:string):Promise<DimensionScope|undefined>{
 if(!kind){requireThat(!id,'Choose a dimension before a value');return undefined}
 requireThat(DIMENSIONS.includes(kind as DimensionKind),'Choose class, location or project')
 const flag={class:'classes_enabled',location:'locations_enabled',project:'projects_enabled'}[kind as DimensionKind]
 requireThat((await one(db,'SELECT * FROM pt_dimension_settings WHERE id=1'))?.[flag],'Enable this dimension before filtering reports',409)
 requireThat(id==='unassigned'||id?.startsWith('value:')&&id.length>6,'Choose a dimension value or Unassigned')
 const value=id==='unassigned'?'':id!.slice(6)
 const historical=value?await one(db,`SELECT 1 FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id WHERE e.status='posted' AND l.${kind}_name=? LIMIT 1`,value):null
 requireThat(!value||historical||await one(db,'SELECT 1 FROM pt_dimensions WHERE kind=? AND name=?',kind,value),'Dimension value not found',404)
 return {kind:kind as DimensionKind,value,id:id!,label:`${kind} · ${value||'Unassigned'}`}
}
export const inDimension=(row:Data,scope?:DimensionScope)=>!scope||String(row[`${scope.kind}_name`]??'')===scope.value
