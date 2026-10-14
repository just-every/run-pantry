// The production auth and API handlers, without the document renderer.
import { authResponse } from '../../src/auth.server'
import { api } from '../../src/pantry/api'

export default { async fetch(request: Request, env: any, ctx: ExecutionContext) { return (await authResponse(request, env)) ?? api.fetch(request, env, ctx) } }
