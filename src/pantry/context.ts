import type { Bindings } from '../auth.server'
import type { Actor, Need } from './access'
import type { Data } from './core'

export type Context = { db: D1Database; env: Bindings; request: Request; actor: Actor }
export type Command = { need: Need; run: (c: Context, body: Data) => Promise<Data> }
