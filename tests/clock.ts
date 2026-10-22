// Test transport clock, outside the product. Production handlers see ordinary
// Requests and the real Date API; no clock override is shipped to the app.
export async function fixtureTime(request: Request, action: (request: Request) => Promise<Response>) {
  const at = request.headers.get('x-synthetic-pantry-clock')
  if (!at) return action(request)
  const NativeDate = globalThis.Date
  const headers = new Headers(request.headers); headers.delete('x-synthetic-pantry-clock')
  const clean = new Request(request, { headers })
  const instant = new NativeDate(at).getTime()
  if (!Number.isFinite(instant)) throw new Error('Invalid fixture clock')
  class ClockDate extends NativeDate {
    constructor(value?: string | number | Date) { super(value === undefined ? instant : value as string) }
    static now() { return instant }
  }
  globalThis.Date = ClockDate as DateConstructor
  try { return await action(clean) } finally { globalThis.Date = NativeDate }
}
