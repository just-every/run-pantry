// The demo's door, as src/server.ts wraps it: Base's demo guard, seeding Juniper Lane's books on the first request.
import { withDemo } from '../../src/modules/demo/index.mjs'
import { seedDemo } from '../../src/demo'
import worker from './worker'

export default withDemo(worker, { seed: seedDemo })
