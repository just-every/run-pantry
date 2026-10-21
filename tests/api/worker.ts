// The production auth and API handlers, without the document renderer.
import { authResponse } from '../../src/auth.server'
import { api } from '../../src/pantry/api'
import { runDue } from '../../src/pantry/feeds/sync'
import { emailHandler } from '../../src/pantry/receipts/mail'
import { runDueWork } from '../../src/pantry/due'
import { runWebhooks } from '../../src/pantry/webhooks/deliver'
import { runAgent } from '../../src/pantry/questions/run'

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) { return (await authResponse(request, env)) ?? api.fetch(request, env, ctx) },
  async scheduled(controller: ScheduledController, env: any) { await runWebhooks(env,controller.scheduledTime); await runDue(env, 10); await runDueWork(env, { scheduled: true }); await runAgent(env, { scheduled: true }) },
  async email(message: ForwardableEmailMessage, env: any) { await emailHandler(message, env) },
}
