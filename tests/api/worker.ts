// The production auth and API handlers, without the document renderer.
import { fixtureTime, fixtureScheduled } from '../clock'
import { authResponse } from '../../src/auth.server'
import { api } from '../../src/pantry/api'
import { emailHandler } from '../../src/pantry/receipts/mail'
import { runScheduled } from '../../src/pantry/scheduled'

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    // Miniflare supplies a peer by default. Simulate its absence only at this
    // test transport boundary; the production handler still sees a real Request.
    if(request.headers.get('x-synthetic-pantry-peer')==='absent') {
      const headers=new Headers(request.headers);headers.delete('cf-connecting-ip');headers.delete('x-synthetic-pantry-peer')
      request=new Request(request,{headers})
    }
    return fixtureTime(request, async request => (await authResponse(request, env)) ?? await api.fetch(request, env, ctx)) },
  async scheduled(controller: ScheduledController, env: any) { await fixtureScheduled(controller.scheduledTime, () => runScheduled(controller,env)) },
  async email(message: ForwardableEmailMessage, env: any) { await emailHandler(message, env) },
}
