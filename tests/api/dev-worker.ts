// The production auth and API behind the local-only dev layer, wrapped exactly
// as src/server.dev.ts wraps the app for `rer dev` (dev sign-in, the key gate).
import worker from './worker'
import { withDevIdentity } from '../../src/modules/operator-auth/dev/index.mjs'
import { authConfig, runtimeBindings, type Bindings } from '../../src/auth.server'
import { devPersonas } from '../../src/dev-personas'

export default withDevIdentity<Bindings, typeof worker>(worker, { bindings: runtimeBindings, config: authConfig, personas: devPersonas })
