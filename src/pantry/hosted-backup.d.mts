import type { Bindings } from '../auth.server'
export function runHostedBackup(env: Bindings, scheduledTime: number): Promise<void>
