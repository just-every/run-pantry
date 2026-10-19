import type { Command } from '../context'
import { saveSettings } from './settings'
import { issueChecks } from './issue'
import { voidCheck } from './void'
import { exportPositivePay } from './positive-pay'

export { checksView } from './views'
export const checkCommands: Record<string, Command> = {
  'check.settings': saveSettings,
  'check.issue': issueChecks,
  'check.void': voidCheck,
  'check.export-positive-pay': exportPositivePay,
}
