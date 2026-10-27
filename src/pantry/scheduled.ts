import { runHostedBackup } from './hosted-backup.mjs'
import { syncDocumentObjects } from './document-objects'
import { upgradeTins } from './contractor-tin'
import type { Bindings } from '../auth.server'
import { runDue } from './feeds/sync'
import { runDueWork } from './due'
import { runAgent } from './questions/run'
import { runWebhooks } from './webhooks/deliver'

/** Minute delivery ticks preserve the existing half-hour accounting schedule. */
export async function runScheduled(controller:{cron:string;scheduledTime:number},env:Bindings) {
  await upgradeTins(env)
  const deliveries=runWebhooks(env,controller.scheduledTime)
  if(controller.cron!=='*/30 * * * *'){await deliveries;return}
  await runDue(env,10)
  await syncDocumentObjects(env)
  await Promise.all([runHostedBackup(env,controller.scheduledTime),deliveries,runDueWork(env,{scheduled:true,reportAt:new Date(controller.scheduledTime)}),runAgent(env,{scheduled:true})])
}
