import type { DevPersona } from './modules/operator-auth/dev/index.mjs'

// Local dev personas: real operators at <as>@dev.localhost, created only by
// local dev sign-in and suspended in exports. Only src/server.dev.ts uses them.
// Each still needs a Pantry role, which the owner gives in Settings › People and permissions.
export function devPersonas(): DevPersona[] {
 return [
  { as: 'bookkeeper', role: 'member', displayName: 'Dev bookkeeper' },
  { as: 'accountant', role: 'member', displayName: 'Dev accountant' },
  { as: 'viewer', role: 'member', displayName: 'Dev viewer' },
 ]
}
