import type { Bindings } from '../auth.server'
export function runHostedBackup(env: Bindings, scheduledTime: number, options?: {resumeOnly?: boolean}): Promise<void>
