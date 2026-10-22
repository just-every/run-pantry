import { authority, who } from '../access'
import { requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run, type Sql } from '../db'
import type { Command } from '../context'
import { dimensionRefusal, dimensionTags, dimensionValues, dimensionsView } from './index'

export const PROCESSOR_ROLES = ['sales','refunds','fees','clearing','bank','receivable'] as const
export type ProcessorRole = typeof PROCESSOR_ROLES[number]

/** Capture the exact owner mapping and fence a provider's eventual atomic posting. */
export async function processorDimensions(db: D1Database) {
 const rows = await all(db,'SELECT * FROM pt_processor_dimensions')
 const coding = (role: ProcessorRole) => dimensionTags(rows.find(row=>row.role===role)??{})
 const guards: Sql[] = PROCESSOR_ROLES.map(role=>guard("COALESCE((SELECT revision FROM pt_processor_dimensions WHERE role=?),'')=?",role,rows.find(row=>row.role===role)?.revision??''))
 return { coding, guards }
}

export const processorCoding: Command = { need:'owner', async run(c,b) {
 const role = text(b.role,'Processor line role') as ProcessorRole
 requireThat(PROCESSOR_ROLES.includes(role),'Choose an existing processor line role')
 const before = await one(c.db,'SELECT * FROM pt_processor_dimensions WHERE role=?',role)
 requireThat((b.revision??'')===(before?.revision??''),'Processor coding changed; reload',409)
 const tags=dimensionTags(b),refusal=await dimensionRefusal(c.db,[],tags)
 requireThat(!refusal,refusal??'Invalid processor dimensions',409)
 await run(c.db,[authority(c.actor,'owner'),guard("COALESCE((SELECT revision FROM pt_processor_dimensions WHERE role=?),'')=?",role,b.revision??''),
  q('INSERT INTO pt_processor_dimensions(role,class_name,location_name,project_name,revision)VALUES(?,?,?,?,?) ON CONFLICT(role) DO UPDATE SET class_name=excluded.class_name,location_name=excluded.location_name,project_name=excluded.project_name,revision=excluded.revision',role,...dimensionValues(tags),uid()),changed(),
  audit(who(c.actor),'dimension.processor','processor-coding',role,{before,after:tags})])
 return dimensionsView(c.db)
} }
