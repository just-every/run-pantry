import { createMailSender } from './modules/mail/index.mjs'

// Demo and local development suppress mail; operator-auth reports the link as
// sent. Construct the provider only on a send: setup never needs mail credentials.
export function operatorMail(env) {
 if (env.RER_DEMO === '1' || (env.MAIL_PROVIDER === 'development' && env.AUTH_LOCAL === 'true')) return createMailSender({ provider: 'development', mode: 'development' })
 if (!env.MAIL_PROVIDER || env.MAIL_PROVIDER === 'development') return undefined
 return { send: message => createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'rer' ? { relayUrl: env.MAIL_RELAY_URL } : {}), ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }).send(message) }
}
