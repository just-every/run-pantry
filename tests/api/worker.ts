// The production auth and API handlers, without the document renderer.
import { authResponse } from '../../src/auth.server'
import { api } from '../../src/pantry/api'
import { emailHandler } from '../../src/pantry/receipts/mail'
import { runScheduled } from '../../src/pantry/scheduled'

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) { return (await authResponse(request, env)) ?? api.fetch(request, env, ctx) },
  async scheduled(controller: ScheduledController, env: any) { await runScheduled(controller,env) },
  async email(message: ForwardableEmailMessage, env: any) { await emailHandler(message, env) },
}
