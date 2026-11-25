import type { MailSender } from './modules/operator-auth/index.mjs'
import type { Bindings } from './auth.server'
export function operatorMail(env: Bindings): MailSender | undefined
export function mailOff(env: Pick<Bindings, 'MAIL_PROVIDER'>): boolean
