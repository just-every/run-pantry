// Booked provider movements meeting their bank lines, run whenever lines arrive.
import { matchPayouts } from './payouts'
import { matchPayrolls } from './gusto/payrolls'

export async function matchConnected(db: D1Database) {
  return (await matchPayouts(db)) + (await matchPayrolls(db))
}
