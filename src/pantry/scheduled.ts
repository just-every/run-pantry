import { drainDocumentObjects } from './document-objects.mjs'
import { runHostedBackup } from './hosted-backup.mjs'
import { upgradeTins } from './contractor-tin'
import type { Bindings } from '../auth.server'
import { runDue } from './feeds/sync'
import { runDueWork } from './due'
import { runAgent } from './questions/run'
import { runWebhooks } from './webhooks/deliver'

/** Minute delivery ticks preserve the existing half-hour accounting schedule. */
export async function runScheduled(controller:{cron:string;scheduledTime:number},env:Bindings) {
  await upgradeTins(env)
  await drainDocumentObjects(env.DB,env.PANTRY_DOCUMENTS)
  const deliveries=runWebhooks(env,controller.scheduledTime)
  if(controller.cron!=='*/30 * * * *'){await Promise.all([runHostedBackup(env,controller.scheduledTime),deliveries]);return}
  await runDue(env,10)
  await Promise.all([runHostedBackup(env,controller.scheduledTime),deliveries,runDueWork(env,{scheduled:true,reportAt:new Date(controller.scheduledTime)}),runAgent(env,{scheduled:true})])
}
