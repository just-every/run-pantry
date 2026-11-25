import { createMailSender } from './modules/mail/index.mjs'

// Mail off (MAIL_PROVIDER=none, set only by rer's mail-off deploy): nothing is ever sent. Every send is refused at
// once with code mail_off, so each flow records why nothing was delivered. The owner signs in with `rer signin`.
const mailOffSender = { send: async () => ({ status: 'rejected', provider: 'none', providerMessageId: null, code: 'mail_off' }) }
export const mailOff = env => env.MAIL_PROVIDER === 'none'

// Demo and local development suppress mail; operator-auth reports the link as
// sent. Construct the provider only on a send: setup never needs mail credentials.
export function operatorMail(env) {
 if (mailOff(env)) return mailOffSender
 if (env.RER_DEMO === '1' || (env.MAIL_PROVIDER === 'development' && env.AUTH_LOCAL === 'true')) return createMailSender({ provider: 'development', mode: 'development' })
 if (!env.MAIL_PROVIDER || env.MAIL_PROVIDER === 'development') return undefined
 return { send: message => createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'rer' ? { relayUrl: env.MAIL_RELAY_URL } : {}), ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }).send(message) }
}
