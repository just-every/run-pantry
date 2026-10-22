// Test transport clock, outside the product. Each request keeps its own instant
// across awaits; concurrent requests must never change another request's clock.
import { AsyncLocalStorage } from 'node:async_hooks'
const clocks = new AsyncLocalStorage<number | undefined>()
const NativeDate = globalThis.Date
const instant = () => clocks.getStore() ?? NativeDate.now()
globalThis.Date = new Proxy(NativeDate, {
  construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [instant()], newTarget) },
  apply() { return new NativeDate(instant()).toString() },
  get(target, property, receiver) { return property === 'now' ? instant : Reflect.get(target, property, receiver) },
})
export async function fixtureTime(request: Request, action: (request: Request) => Promise<Response>) {
  const at = request.headers.get('x-synthetic-pantry-clock')
  if (!at) return clocks.run(undefined, () => action(request))
  const headers = new Headers(request.headers); headers.delete('x-synthetic-pantry-clock')
  const clean = new Request(request, { headers })
  const time = new NativeDate(at).getTime()
  if (!Number.isFinite(time)) throw new Error('Invalid fixture clock')
  return clocks.run(time, () => action(clean))
}
